import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  isJsonNumber,
  isJsonString,
  parseJsonObject,
} from "@chief/relay-contracts";

import type { StartOptions } from "../types.js";

export interface OpenCodeTerminalState {
  process: ChildProcess;
  output: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  pendingWaitId?: number | string;
  pendingWaitTimer?: ReturnType<typeof setTimeout>;
}

const TERMINAL_WAIT_TIMEOUT_MS = Number(
  process.env.CHIEF_TERMINAL_TIMEOUT_MS ?? 60_000,
);

export function findOpenCode() {
  const candidates = [
    process.env.OPENCODE_PATH,
    join(homedir(), ".opencode", "bin", "opencode"),
    join(homedir(), ".local", "bin", "opencode"),
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
  ].filter((value): value is string => Boolean(value));
  return candidates.find(existsSync) ?? "opencode";
}

export function openCodeRecord(value: JsonValue | undefined): JsonObject {
  return parseJsonObject(value) ?? {};
}

export function openCodeTextContent(value: JsonValue | undefined) {
  if (isJsonString(value)) return value;
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        const part = openCodeRecord(item);
        if (isJsonString(part.text)) return [part.text];
        const nested = openCodeRecord(part.content);
        return isJsonString(nested.text) ? [nested.text] : [];
      })
      .join("\n");
  }
  const item = openCodeRecord(value);
  return isJsonString(item.text) ? item.text : "";
}

/**
 * Chief runs OpenCode headlessly, so an `ask` permission has no provider UI in
 * which it can be answered. Full-access sessions must therefore encode that
 * choice up front. In particular, OpenCode otherwise pauses forever whenever
 * an agent workspace follows a project path outside its own cwd.
 */
export function openCodeConfigContent(
  options: Pick<StartOptions, "access" | "model">,
  inherited?: string,
) {
  let config: JsonObject = {};
  if (inherited) {
    try {
      const parsed: unknown = JSON.parse(inherited);
      config = parseJsonObject(parsed) ?? {};
    } catch {
      // Ignore malformed ambient config rather than preventing Chief startup.
    }
  }
  if (options.model) config.model = options.model;
  if (options.access !== "full") return JSON.stringify(config);

  const existing = config.permission;
  const permission: JsonObject = isJsonString(existing)
    ? { "*": existing }
    : { ...openCodeRecord(existing) };
  permission.external_directory = "allow";
  config.permission = permission;
  return JSON.stringify(config);
}

export async function initializeOpenCodeSession(
  options: StartOptions,
  resumeSessionId: string | undefined,
  rpc: (method: string, params: JsonObject) => Promise<JsonValue | undefined>,
) {
  const initialized = openCodeRecord(
    await rpc("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: "chief", version: "0.1.0" },
    }),
  );
  const capabilities = openCodeRecord(initialized.agentCapabilities);
  const supportsStdio =
    openCodeRecord(capabilities.mcpCapabilities).stdio === true;
  const mcpServers: JsonObject[] = (options.mcpServers ?? []).flatMap(
    (server): JsonObject[] => {
      if (server.url) {
        return [
          {
            type: "http",
            name: server.name,
            url: server.url,
            headers: Object.entries(server.headers ?? {}).map(
              ([name, value]) => ({
                name,
                value,
              }),
            ),
          },
        ];
      }
      if (supportsStdio) {
        return [
          {
            name: server.name,
            command: server.command,
            args: server.args,
            ...(server.cwd ? { cwd: server.cwd } : undefined),
            env: server.env ?? {},
          },
        ];
      }
      console.error(
        `[opencode] Dropping stdio MCP server "${server.name}" because this OpenCode version only accepts http/sse MCP over ACP.`,
      );
      return [];
    },
  );
  const sessionParameters: JsonObject = {
    cwd: options.cwd,
    ...(options.additionalDirectories
      ? { additionalDirectories: options.additionalDirectories }
      : undefined),
    mcpServers,
  };
  let session: JsonObject;
  if (
    resumeSessionId &&
    (capabilities.loadSession ||
      openCodeRecord(capabilities.sessionCapabilities).loadSession)
  ) {
    try {
      session = openCodeRecord(
        await rpc("session/load", {
          sessionId: resumeSessionId,
          ...sessionParameters,
        }),
      );
    } catch {
      session = openCodeRecord(await rpc("session/new", sessionParameters));
    }
  } else {
    session = openCodeRecord(await rpc("session/new", sessionParameters));
  }
  const sessionId = session.sessionId ?? session.id ?? resumeSessionId;
  if (!isJsonString(sessionId)) {
    throw new Error("OpenCode returned no ACP session id.");
  }
  const currentModelId = openCodeRecord(session.models).currentModelId;
  return {
    sessionId,
    model: isJsonString(currentModelId) ? currentModelId : options.model,
  };
}

interface HostServiceOptions {
  cwd: () => string;
  environment: () => NodeJS.ProcessEnv;
  respond: (id: number | string, result: JsonValue | undefined) => void;
  terminals: Map<string, OpenCodeTerminalState>;
}

export class OpenCodeHostServices {
  private nextTerminalId = 0;

  constructor(private readonly options: HostServiceOptions) {}

  readFile(id: number | string, params: JsonObject) {
    const path = params.path ?? params.filePath;
    try {
      if (!isJsonString(path)) throw new Error("No file path provided.");
      this.options.respond(id, { content: readFileSync(path, "utf8") });
    } catch (error) {
      this.options.respond(id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  writeFile(id: number | string, params: JsonObject) {
    const path = params.path ?? params.filePath;
    try {
      if (!isJsonString(path)) throw new Error("No file path provided.");
      if (!isJsonString(params.content)) {
        throw new Error("No file content provided.");
      }
      writeFileSync(path, params.content, "utf8");
      this.options.respond(id, {});
    } catch (error) {
      this.options.respond(id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  terminal(id: number | string, method: string, params: JsonObject) {
    const requestedTerminalId = params.terminalId;
    const terminalId =
      isJsonString(requestedTerminalId) || isJsonNumber(requestedTerminalId)
        ? String(requestedTerminalId)
        : `terminal-${++this.nextTerminalId}`;
    if (method === "terminal/create") {
      if (!isJsonString(params.command)) {
        this.options.respond(id, { error: "No command provided." });
        return;
      }
      const args = Array.isArray(params.args)
        ? params.args.map(openCodeArgument)
        : [];
      const child = spawn(params.command, args, {
        cwd: isJsonString(params.cwd) ? params.cwd : this.options.cwd(),
        env: this.options.environment(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      const state: OpenCodeTerminalState = {
        process: child,
        output: "",
        exitCode: null,
        signal: null,
      };
      this.options.terminals.set(terminalId, state);
      child.stdout.on("data", (chunk) => (state.output += String(chunk)));
      child.stderr.on("data", (chunk) => (state.output += String(chunk)));
      child.on("exit", (code, signal) => {
        state.exitCode = code;
        state.signal = signal;
        if (state.pendingWaitTimer) clearTimeout(state.pendingWaitTimer);
        state.pendingWaitTimer = undefined;
        if (state.pendingWaitId !== undefined) {
          this.options.respond(state.pendingWaitId, { exitCode: code, signal });
          state.pendingWaitId = undefined;
        }
      });
      this.options.respond(id, { terminalId });
      return;
    }
    const state = this.options.terminals.get(terminalId);
    if (method === "terminal/output") {
      this.options.respond(id, {
        output: state?.output ?? "",
        truncated: false,
        exitStatus:
          state && state.exitCode !== null
            ? { exitCode: state.exitCode, signal: state.signal }
            : null,
      });
    } else if (method === "terminal/wait_for_exit") {
      this.waitForExit(id, state);
    } else if (method === "terminal/kill" || method === "terminal/release") {
      if (state?.pendingWaitTimer) clearTimeout(state.pendingWaitTimer);
      if (state) state.pendingWaitTimer = undefined;
      state?.process.kill("SIGTERM");
      if (method === "terminal/release") {
        this.options.terminals.delete(terminalId);
      }
      this.options.respond(id, {});
    }
  }

  private waitForExit(id: number | string, state?: OpenCodeTerminalState) {
    if (!state) {
      this.options.respond(id, {
        exitCode: null,
        signal: null,
      });
      return;
    }
    if (state.exitCode !== null) {
      this.options.respond(id, {
        exitCode: state.exitCode,
        signal: state.signal,
      });
      return;
    }
    state.pendingWaitId = id;
    state.pendingWaitTimer = setTimeout(() => {
      if (state.pendingWaitId !== id) return;
      state.pendingWaitId = undefined;
      state.pendingWaitTimer = undefined;
      state.process.kill("SIGKILL");
      this.options.respond(id, {
        exitCode: null,
        signal: "SIGKILL",
        error: "Command timed out.",
      });
    }, TERMINAL_WAIT_TIMEOUT_MS);
    state.pendingWaitTimer.unref();
  }
}

function openCodeArgument(value: JsonValue) {
  if (isJsonString(value)) return value;
  const serialized = JSON.stringify(value);
  return isJsonString(serialized) ? serialized : "";
}
