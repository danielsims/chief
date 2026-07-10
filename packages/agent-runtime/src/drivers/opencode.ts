import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BaseDriver } from "./base.js";
import type { ContentBlock, StartOptions } from "../types.js";

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

interface TerminalState {
  process: ChildProcess;
  output: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  pendingWaitId?: number | string;
}

function findOpenCode() {
  const candidates = [
    process.env.OPENCODE_PATH,
    join(homedir(), ".opencode", "bin", "opencode"),
    join(homedir(), ".local", "bin", "opencode"),
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
  ].filter((value): value is string => Boolean(value));
  return candidates.find(existsSync) ?? "opencode";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textContent(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        const part = record(item);
        if (typeof part.text === "string") return [part.text];
        const nested = record(part.content);
        return typeof nested.text === "string" ? [nested.text] : [];
      })
      .join("\n");
  }
  const item = record(value);
  return typeof item.text === "string" ? item.text : "";
}

/** OpenCode adapter over ACP JSON-RPC on stdio. */
export class OpenCodeDriver extends BaseDriver {
  private process: ChildProcess | null = null;
  private sessionId: string | undefined;
  private buffer = "";
  private nextRpcId = 0;
  private pending = new Map<number | string, PendingRpc>();
  private permissions = new Map<
    string,
    { rpcId: number | string; allow: string; deny: string }
  >();
  private activeTools = new Map<string, { name: string; input: unknown }>();
  private terminals = new Map<string, TerminalState>();
  private nextTerminalId = 0;
  private stream = "";
  private thinking = "";
  private stopping = false;
  private access: StartOptions["access"] = "guarded";
  private cwd = homedir();
  private environment: NodeJS.ProcessEnv = { ...process.env };

  async start(options: StartOptions) {
    this.access = options.access;
    this.cwd = options.cwd;
    this.sessionId = options.resumeSessionId;
    writeFileSync(join(options.cwd, "AGENTS.md"), options.instructions);
    const env = { ...process.env, ...options.env };
    this.environment = env;
    if (options.model) {
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: options.model });
    }
    this.process = spawn(findOpenCode(), ["acp"], {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    this.process.stdout?.on("data", (chunk) => this.consume(String(chunk)));
    this.process.stderr?.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) console.error(`[opencode] ${message.slice(0, 800)}`);
    });
    this.process.on("error", (error) => {
      this.emitEvent({ type: "error", message: error.message });
    });
    this.process.on("exit", (code) => {
      this.rejectPending("OpenCode exited.");
      if (!this.stopping && code !== 0) {
        this.emitEvent({
          type: "error",
          message: `OpenCode exited unexpectedly${code === null ? "." : ` with code ${code}.`}`,
        });
      }
      this.emitEvent({ type: "exit", code });
      this.emitEvent({ type: "status", status: "idle" });
    });

    const initialized = record(
      await this.rpc("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: "marketer", version: "0.1.0" },
      }),
    );
    const capabilities = record(initialized.agentCapabilities);
    const mcpServers = (options.mcpServers ?? []).map((server) => ({
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env ?? {},
    }));
    let session: Record<string, unknown>;
    if (
      this.sessionId &&
      (capabilities.loadSession ||
        record(capabilities.sessionCapabilities).loadSession)
    ) {
      try {
        session = record(
          await this.rpc("session/load", {
            sessionId: this.sessionId,
            cwd: options.cwd,
            mcpServers,
          }),
        );
      } catch {
        session = record(
          await this.rpc("session/new", { cwd: options.cwd, mcpServers }),
        );
      }
    } else {
      session = record(
        await this.rpc("session/new", { cwd: options.cwd, mcpServers }),
      );
    }
    const sessionId = session.sessionId ?? session.id;
    if (typeof sessionId !== "string") {
      throw new Error("OpenCode returned no ACP session id.");
    }
    this.sessionId = sessionId;
    const currentModelId = record(session.models).currentModelId;
    this.emitEvent({
      type: "init",
      sessionId,
      model:
        typeof currentModelId === "string" ? currentModelId : options.model,
    });
    this.emitEvent({ type: "status", status: "idle" });
  }

  async sendPrompt(text: string) {
    if (!this.sessionId) throw new Error("OpenCode session is not ready.");
    this.stream = "";
    this.thinking = "";
    this.activeTools.clear();
    this.emitEvent({ type: "status", status: "running" });
    try {
      const result = record(
        await this.rpc(
          "session/prompt",
          {
            sessionId: this.sessionId,
            prompt: [{ type: "text", text }],
          },
          0,
        ),
      );
      const content: ContentBlock[] = [];
      if (this.thinking) {
        content.push({ type: "thinking", thinking: this.thinking });
      }
      if (this.stream) content.push({ type: "text", text: this.stream });
      if (content.length > 0) {
        this.emitEvent({ type: "message", role: "assistant", content });
      }
      const stopReason = result.stopReason;
      this.emitEvent({
        type: "result",
        ok: stopReason !== "refusal" && stopReason !== "error",
        error:
          stopReason === "refusal" || stopReason === "error"
            ? String(stopReason)
            : undefined,
      });
    } catch (error) {
      this.emitEvent({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.stream = "";
      this.thinking = "";
      this.emitEvent({ type: "status", status: "idle" });
    }
  }

  async interrupt() {
    this.process?.kill("SIGINT");
  }

  async stop() {
    this.stopping = true;
    for (const terminal of this.terminals.values()) {
      terminal.process.kill("SIGTERM");
    }
    this.terminals.clear();
    const pid = this.process?.pid;
    if (pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        this.process?.kill("SIGTERM");
      }
    }
    this.rejectPending("OpenCode stopped.");
    this.process = null;
  }

  override respondPermission(requestId: string, behavior: "allow" | "deny") {
    const pending = this.permissions.get(requestId);
    if (!pending) return;
    this.permissions.delete(requestId);
    this.respond(pending.rpcId, {
      optionId: behavior === "allow" ? pending.allow : pending.deny,
    });
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.handle(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // OpenCode diagnostics occasionally share stdout with ACP.
      }
    }
  }

  private handle(message: Record<string, unknown>) {
    const id = message.id as number | string | undefined;
    const method = message.method;
    if (id !== undefined && typeof method !== "string") {
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      if (request.timer) clearTimeout(request.timer);
      const error = record(message.error);
      if (typeof error.message === "string") {
        request.reject(new Error(error.message));
      } else request.resolve(message.result);
      return;
    }
    if (typeof method !== "string") return;
    const params = record(message.params);
    if (method === "session/update") this.sessionUpdate(params);
    else if (method === "session/request_permission" && id !== undefined) {
      this.permission(id, params);
    } else if (method === "fs/read_text_file" && id !== undefined) {
      this.readFile(id, params);
    } else if (method === "fs/write_text_file" && id !== undefined) {
      this.writeFile(id, params);
    } else if (method.startsWith("terminal/") && id !== undefined) {
      this.terminal(id, method, params);
    }
  }

  private sessionUpdate(params: Record<string, unknown>) {
    const update = record(params.update ?? params);
    const type = update.type ?? update.sessionUpdate;
    if (type === "agent_message_chunk") {
      const text = textContent(update.content);
      if (text) {
        this.stream += text;
        this.emitEvent({ type: "stream", text });
      }
      return;
    }
    if (type === "agent_thought_chunk") {
      this.thinking += textContent(update.content) || String(update.text ?? "");
      return;
    }
    if (
      type === "tool_call" ||
      type === "tool_call_start" ||
      type === "tool_call_update" ||
      type === "tool_call_end"
    ) {
      this.toolUpdate(update, String(type));
    }
  }

  private toolUpdate(update: Record<string, unknown>, eventType: string) {
    const nested = record(update.toolCall ?? update.tool_call ?? update.tool);
    const id = String(
      update.toolCallId ??
        update.tool_call_id ??
        update.id ??
        nested.id ??
        randomUUID(),
    );
    const name = String(
      update.title ??
        update.name ??
        update.toolName ??
        nested.name ??
        "OpenCode tool",
    );
    let input: unknown =
      update.input ?? update.rawInput ?? update.arguments ?? nested.input ?? {};
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        input = { value: input };
      }
    }
    if (!this.activeTools.has(id)) {
      this.activeTools.set(id, { name, input });
      const prefix: ContentBlock[] = this.thinking
        ? [{ type: "thinking", thinking: this.thinking }]
        : [];
      this.thinking = "";
      this.emitEvent({
        type: "message",
        role: "assistant",
        content: [...prefix, { type: "tool_use", id, name, input }],
      });
    }
    const status = String(update.status ?? "").toLowerCase();
    const complete =
      eventType === "tool_call_end" ||
      status === "completed" ||
      status === "failed";
    if (!complete) return;
    const failed = status === "failed";
    const content = failed
      ? String(update.error ?? update.message ?? "Tool call failed")
      : textContent(update.content) ||
        (typeof update.result === "string"
          ? update.result
          : JSON.stringify(update.result ?? update.output ?? "Completed"));
    this.emitEvent({
      type: "message",
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: id, content, is_error: failed },
      ],
    });
    this.activeTools.delete(id);
  }

  private permission(id: number | string, params: Record<string, unknown>) {
    const options = Array.isArray(params.options)
      ? params.options.map(record)
      : [];
    const allow =
      options.find(
        (option) => option.kind === "allow_once" || option.id === "allow-once",
      ) ?? options[0];
    const deny =
      options.find(
        (option) =>
          option.kind === "reject_once" || option.id === "reject-once",
      ) ?? options.at(-1);
    const allowId = String(allow?.optionId ?? allow?.id ?? "allow-once");
    const denyId = String(deny?.optionId ?? deny?.id ?? "reject-once");
    if (this.access === "full") {
      this.respond(id, { optionId: allowId });
      return;
    }
    const toolCall = record(params.toolCall);
    const requestId = randomUUID();
    this.permissions.set(requestId, {
      rpcId: id,
      allow: allowId,
      deny: denyId,
    });
    this.emitEvent({
      type: "permission",
      requestId,
      toolName: String(
        toolCall.name ?? params.toolName ?? params.title ?? "OpenCode tool",
      ),
      input: toolCall.input ?? params.input ?? params.description ?? {},
    });
    this.emitEvent({ type: "status", status: "waiting" });
  }

  private readFile(id: number | string, params: Record<string, unknown>) {
    const path = params.path ?? params.filePath;
    try {
      if (typeof path !== "string") throw new Error("No file path provided.");
      this.respond(id, { content: readFileSync(path, "utf8") });
    } catch (error) {
      this.respond(id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private writeFile(id: number | string, params: Record<string, unknown>) {
    const path = params.path ?? params.filePath;
    try {
      if (typeof path !== "string") throw new Error("No file path provided.");
      if (typeof params.content !== "string") {
        throw new Error("No file content provided.");
      }
      writeFileSync(path, params.content, "utf8");
      this.respond(id, {});
    } catch (error) {
      this.respond(id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private terminal(
    id: number | string,
    method: string,
    params: Record<string, unknown>,
  ) {
    const terminalId = String(
      params.terminalId ?? `terminal-${++this.nextTerminalId}`,
    );
    if (method === "terminal/create") {
      if (typeof params.command !== "string") {
        this.respond(id, { error: "No command provided." });
        return;
      }
      const args = Array.isArray(params.args) ? params.args.map(String) : [];
      const child = spawn(params.command, args, {
        cwd: typeof params.cwd === "string" ? params.cwd : this.cwd,
        env: this.environment,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const state: TerminalState = {
        process: child,
        output: "",
        exitCode: null,
        signal: null,
      };
      this.terminals.set(terminalId, state);
      child.stdout?.on("data", (chunk) => (state.output += String(chunk)));
      child.stderr?.on("data", (chunk) => (state.output += String(chunk)));
      child.on("exit", (code, signal) => {
        state.exitCode = code;
        state.signal = signal;
        if (state.pendingWaitId !== undefined) {
          this.respond(state.pendingWaitId, { exitCode: code, signal });
          state.pendingWaitId = undefined;
        }
      });
      this.respond(id, { terminalId });
      return;
    }
    const state = this.terminals.get(terminalId);
    if (method === "terminal/output") {
      this.respond(id, {
        output: state?.output ?? "",
        truncated: false,
        exitStatus:
          state && state.exitCode !== null
            ? { exitCode: state.exitCode, signal: state.signal }
            : null,
      });
    } else if (method === "terminal/wait_for_exit") {
      if (!state || state.exitCode !== null) {
        this.respond(id, {
          exitCode: state?.exitCode ?? null,
          signal: state?.signal ?? null,
        });
      } else state.pendingWaitId = id;
    } else if (method === "terminal/kill" || method === "terminal/release") {
      state?.process.kill("SIGTERM");
      if (method === "terminal/release") this.terminals.delete(terminalId);
      this.respond(id, {});
    }
  }

  private rpc(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 30_000,
  ) {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error("OpenCode is not running."));
        return;
      }
      const id = ++this.nextRpcId;
      const pending: PendingRpc = { resolve, reject };
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${method} timed out.`));
        }, timeoutMs);
      }
      this.pending.set(id, pending);
      this.process.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  private respond(id: number | string, result: unknown) {
    this.process?.stdin?.write(`${JSON.stringify({ id, result })}\n`);
  }

  private rejectPending(message: string) {
    for (const request of this.pending.values()) {
      if (request.timer) clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }
}
