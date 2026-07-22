/* eslint-disable max-lines */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";

import type { AgentQuestion, ContentBlock, StartOptions } from "../types.js";
import {
  executorAddressesFromCode,
  executorAddressFromElicitation,
  executorCodeUsesOnlyCatalogHelpers,
  grantAllowsAddress,
} from "../recurring-work.js";
import { BaseDriver } from "./base.js";
import { agentEnvironment } from "./environment.js";

const moduleDirectory =
  typeof __dirname === "string"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

function findCodex(): string {
  if (process.env.CODEX_PATH) return process.env.CODEX_PATH;
  if (process.env.CHIEF_CODEX_BINARY) return process.env.CHIEF_CODEX_BINARY;
  const packageCodex = join(
    moduleDirectory,
    "..",
    "..",
    "node_modules",
    ".bin",
    "codex",
  );
  for (const p of [
    packageCodex,
    join(homedir(), ".local/bin/codex"),
    "/usr/local/bin/codex",
    "/opt/homebrew/bin/codex",
  ]) {
    if (existsSync(p)) return p;
  }
  return "codex";
}

interface RpcRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Drives the Codex CLI via `codex app-server` — JSON-RPC 2.0 over
 * stdin/stdout (JSONL). Uses the user's existing `codex auth login`
 * credentials, so inference bills to their subscription.
 */
function mcpTokenEnvName(serverName: string) {
  return `MCP_${serverName.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_TOKEN`;
}

export class CodexDriver extends BaseDriver {
  private proc: ChildProcess | null = null;
  private threadId: string | undefined;
  private turnId: string | undefined;
  private rpcId = 0;
  private pending = new Map<number, RpcRequest>();
  private approvals = new Map<
    string,
    { rpcId: number; kind: "codex" | "mcp" }
  >();
  private pendingQuestions = new Map<
    string,
    {
      rpcId: number;
      questions: {
        id: string;
        question: string;
        optionLabels: Set<string>;
      }[];
    }
  >();
  private activeToolUseIds = new Set<string>();
  private currentStream = "";
  private opts: StartOptions | null = null;
  private stopping = false;
  private stderrTail = "";

  private finishActiveTools(content: string, isError = false) {
    if (this.activeToolUseIds.size === 0) return;
    this.emitEvent({
      type: "message",
      role: "assistant",
      content: Array.from(this.activeToolUseIds, (toolUseId) => ({
        type: "tool_result" as const,
        tool_use_id: toolUseId,
        content,
        is_error: isError,
      })),
    });
    this.activeToolUseIds.clear();
  }

  async start(opts: StartOptions): Promise<void> {
    this.opts = opts;
    this.threadId = opts.resumeSessionId;
    // Codex reads per-directory instructions from AGENTS.md (same approach
    // as orbit): materialize the agent persona into the working dir.
    try {
      writeFileSync(join(opts.cwd, "AGENTS.md"), opts.instructions);
    } catch {
      // non-fatal
    }
    const codexHome = this.prepareCodexHome(opts);
    const environment = agentEnvironment(opts.env);
    // Read-only native web search is part of every Chief agent's research
    // surface. Without it, a scheduled writer or prospector can only inspect
    // already-connected records and turns a missing optional connector into a
    // dead end. Provider mutations remain governed by Executor separately.
    this.proc = spawn(findCodex(), ["--search", "app-server"], {
      cwd: opts.cwd,
      env: {
        ...environment,
        ...Object.fromEntries(
          (opts.mcpServers ?? []).flatMap((server) => {
            const bearer =
              server.url &&
              server.headers?.Authorization?.match(/^Bearer (.+)$/);
            return bearer ? [[mcpTokenEnvName(server.name), bearer[1]]] : [];
          }),
        ),
        CODEX_HOME: codexHome,
      },
      stdio: ["pipe", "pipe", "pipe"],
      // A process group lets stop() terminate Codex and every MCP child it
      // spawned. Killing only the wrapper leaks app-server/Executor processes.
      detached: true,
    });

    this.proc.on("exit", (code, signal) => {
      const detail = this.stderrTail
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      const reason = `Codex exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}${detail ? `: ${detail}` : "."}`;
      this.rejectPending(reason);
      this.finishActiveTools(
        "Tool stopped because the agent runtime exited.",
        true,
      );
      if (!this.stopping && code !== 0) {
        this.emitEvent({
          type: "error",
          message: `Codex exited unexpectedly${code === null ? "." : ` with code ${code}.`}`,
        });
      }
      this.emitEvent({ type: "exit", code });
      this.emitEvent({ type: "status", status: "idle" });
    });
    this.proc.on("error", (err) => {
      this.rejectPending(`Could not start Codex: ${err.message}`);
      this.emitEvent({ type: "error", message: err.message });
    });
    // Codex writes diagnostics to stderr. Always drain it so a full pipe can
    // never stall the app-server while a turn is streaming.
    this.proc.stderr?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) {
        this.stderrTail = `${this.stderrTail}\n${text}`.slice(-4_000);
        console.error(`[codex] ${text.slice(0, 800)}`);
      }
    });

    const rl = createInterface({ input: this.proc.stdout! });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        this.handleMessage(JSON.parse(line));
      } catch {
        // non-JSON output, ignore
      }
    });

    await this.rpc(
      "initialize",
      {
        clientInfo: { name: "chief", version: "0.1.0" },
        // Required by the current app-server protocol. Omitting this field
        // leaves initialize unanswered on Codex 0.144+, which surfaces as an
        // RPC timeout even though the child process started successfully.
        capabilities: null,
      },
      // A fresh CODEX_HOME may perform a state-store backfill before replying.
      // Codex itself waits up to 30 seconds before retrying that migration, so
      // the host must not race it with the normal request timeout.
      90_000,
    );
    this.notify("initialized", {});

    // Response carries the thread object: { thread: { id, ... } } on current
    // codex; older builds returned { threadId } — accept both.
    const threadIdOf = (res: any): string | undefined =>
      res?.thread?.id ?? res?.threadId;

    // Guarded sessions: codex's "untrusted" policy auto-runs its trusted
    // read/probe commands and asks for everything else via permission
    // events. Full-access sessions (user-initiated setup runs) drop the
    // sandbox entirely — workspace-write blocks Homebrew, binding OAuth
    // callback ports and opening the browser, which breaks real setup.
    const accessParams: Record<string, unknown> =
      opts.access === "full"
        ? { approvalPolicy: "never", sandbox: "danger-full-access" }
        : { approvalPolicy: "untrusted", sandbox: "workspace-write" };

    if (this.threadId) {
      let res: unknown;
      try {
        res = await this.rpc("thread/resume", {
          threadId: this.threadId,
          ...accessParams,
        });
      } catch {
        // older/newer app-servers can reject optional fields — retry bare
        try {
          res = await this.rpc("thread/resume", { threadId: this.threadId });
        } catch {
          res = await this.rpc("thread/start", {
            cwd: opts.cwd,
            ...accessParams,
            ...(opts.model ? { model: opts.model } : {}),
          });
        }
      }
      this.threadId = threadIdOf(res) ?? this.threadId;
    } else {
      const params: Record<string, unknown> = {
        cwd: opts.cwd,
        ...accessParams,
        ...(opts.model ? { model: opts.model } : {}),
      };
      let res: unknown;
      try {
        res = await this.rpc("thread/start", params);
      } catch {
        // older/newer app-servers can reject optional fields — retry bare
        res = await this.rpc("thread/start", { cwd: opts.cwd });
      }
      const id = threadIdOf(res);
      if (!id) throw new Error("codex thread/start returned no thread id");
      this.threadId = id;
    }
    this.emitEvent({
      type: "init",
      sessionId: this.threadId,
      model: opts.model,
    });
  }

  private prepareCodexHome(opts: StartOptions) {
    const storageKey = opts.storageKey ?? opts.cwd;
    const storageId = createHash("sha256")
      .update(storageKey)
      .digest("hex")
      .slice(0, 32);
    const target = join(homedir(), ".chief", "codex", storageId);
    mkdirSync(target, { recursive: true });
    const userHome = join(homedir(), ".codex");
    const auth = join(userHome, "auth.json");
    if (existsSync(auth)) copyFileSync(auth, join(target, "auth.json"));

    const lines: string[] = [];
    const model = opts.model ?? this.readUserCodexSetting("model");
    if (model) lines.push(`model = ${JSON.stringify(model)}`);
    lines.push('model_reasoning_effort = "medium"');
    lines.push("", "[features]", "default_mode_request_user_input = true");
    for (const server of opts.mcpServers ?? []) {
      lines.push("", `[mcp_servers.${server.name}]`);
      if (server.url) {
        // The daemon's streamable-HTTP endpoint is the reliable transport;
        // the stdio child has returned empty results for integration calls.
        // Codex takes the bearer through an env var, never inline TOML.
        lines.push(`url = ${JSON.stringify(server.url)}`);
        if (server.headers?.Authorization?.startsWith("Bearer ")) {
          lines.push(
            `bearer_token_env_var = ${JSON.stringify(mcpTokenEnvName(server.name))}`,
          );
        }
      } else {
        lines.push(`command = ${JSON.stringify(server.command)}`);
        lines.push(
          `args = [${server.args.map((value) => JSON.stringify(value)).join(", ")}]`,
        );
        if (server.env && Object.keys(server.env).length > 0) {
          const env = Object.entries(server.env)
            .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
            .join(", ");
          lines.push(`env = { ${env} }`);
        }
      }
      lines.push("startup_timeout_sec = 30");
    }
    writeFileSync(join(target, "config.toml"), `${lines.join("\n")}\n`);
    return target;
  }

  private readUserCodexSetting(key: string) {
    try {
      const config = readFileSync(
        join(homedir(), ".codex", "config.toml"),
        "utf8",
      );
      return new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m").exec(config)?.[1];
    } catch {
      return undefined;
    }
  }

  private handleMessage(msg: {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { message: string };
  }) {
    // RPC response
    if (msg.id !== undefined && !msg.method) {
      const req = this.pending.get(msg.id);
      if (req) {
        this.pending.delete(msg.id);
        clearTimeout(req.timer);
        if (msg.error) req.reject(new Error(msg.error.message));
        else req.resolve(msg.result);
      }
      return;
    }

    const p = (msg.params ?? {}) as Record<string, any>;
    const isServerRequest =
      msg.id !== undefined &&
      Boolean(msg.method) &&
      msg.result === undefined &&
      !msg.error;

    if (
      msg.id !== undefined &&
      msg.method === "item/tool/requestUserInput" &&
      isServerRequest
    ) {
      const rawQuestions = Array.isArray(p.questions) ? p.questions : [];
      const parsed = rawQuestions.flatMap((candidate: unknown) => {
        if (!candidate || typeof candidate !== "object") return [];
        const question = candidate as Record<string, unknown>;
        if (
          typeof question.id !== "string" ||
          typeof question.question !== "string" ||
          question.isSecret === true
        ) {
          return [];
        }
        const options = Array.isArray(question.options)
          ? question.options.flatMap((candidateOption: unknown) => {
              if (!candidateOption || typeof candidateOption !== "object") {
                return [];
              }
              const option = candidateOption as Record<string, unknown>;
              return typeof option.label === "string"
                ? [
                    {
                      label: option.label,
                      description:
                        typeof option.description === "string"
                          ? option.description
                          : undefined,
                    },
                  ]
                : [];
            })
          : [];
        if (options.length === 0) return [];
        return [
          {
            driver: {
              id: question.id,
              question: question.question,
              optionLabels: new Set(options.map((option) => option.label)),
            },
            ui: {
              question: question.question,
              header:
                typeof question.header === "string"
                  ? question.header
                  : undefined,
              multiSelect: false,
              allowFreeform: question.isOther !== false,
              dismissible: false,
              options,
            } satisfies AgentQuestion,
          },
        ];
      });
      if (parsed.length !== rawQuestions.length || parsed.length === 0) {
        this.write({
          jsonrpc: "2.0",
          id: msg.id,
          result: { answers: {} },
        });
        return;
      }
      const requestId = `codex-input-${msg.id}`;
      this.pendingQuestions.set(requestId, {
        rpcId: msg.id,
        questions: parsed.map((question) => question.driver),
      });
      this.emitEvent({
        type: "question",
        requestId,
        questions: parsed.map((question) => question.ui),
      });
      this.emitEvent({ type: "status", status: "waiting" });
      return;
    }

    // Server -> client approval requests (RPC with id)
    if (
      msg.id !== undefined &&
      (msg.method === "item/commandExecution/requestApproval" ||
        msg.method === "item/fileChange/requestApproval")
    ) {
      const requestId = `codex-${msg.id}`;
      this.emitEvent({
        type: "permission",
        requestId,
        toolName: msg.method.includes("command") ? "bash" : "fileChange",
        input: p,
      });
      if (this.opts?.automationGrant) {
        this.write({
          jsonrpc: "2.0",
          id: msg.id,
          result: { decision: "decline" },
        });
      } else {
        this.approvals.set(requestId, { rpcId: msg.id, kind: "codex" });
      }
      return;
    }

    switch (msg.method) {
      case "turn/started":
        this.turnId = p.turnId ?? p.turn?.id;
        this.currentStream = "";
        this.emitEvent({ type: "status", status: "running" });
        break;
      case "item/agentMessage/delta":
        {
          const delta =
            typeof p.delta === "string"
              ? p.delta
              : typeof p.delta?.text === "string"
                ? p.delta.text
                : typeof p.text === "string"
                  ? p.text
                  : "";
          if (delta) {
            this.currentStream += delta;
            this.emitEvent({ type: "stream", text: delta });
          }
        }
        break;
      case "item/commandExecution/outputDelta": {
        const output =
          typeof p.output === "string"
            ? p.output
            : typeof p.output?.text === "string"
              ? p.output.text
              : typeof p.delta === "string"
                ? p.delta
                : "";
        const toolUseId = String(p.itemId ?? p.item?.id ?? p.id ?? "command");
        if (output) {
          this.emitEvent({ type: "toolProgress", toolUseId, text: output });
        }
        break;
      }
      case "item/mcpToolCall/progress": {
        const text =
          typeof p.message === "string"
            ? p.message
            : typeof p.delta === "string"
              ? p.delta
              : "";
        const toolUseId = String(p.itemId ?? p.item?.id ?? p.id ?? "tool");
        if (text) this.emitEvent({ type: "toolProgress", toolUseId, text });
        break;
      }
      case "item/started": {
        const item = (p.item ?? p) as Record<string, any>;
        const blocks = this.itemStartedToBlocks(item);
        if (blocks.length > 0) {
          this.emitEvent({
            type: "message",
            role: "assistant",
            content: blocks,
          });
        }
        break;
      }
      case "item/completed": {
        const item = p.item as Record<string, any> | undefined;
        if (!item) break;
        const blocks = this.itemToBlocks(item);
        if (blocks.length > 0) {
          this.emitEvent({
            type: "message",
            role: "assistant",
            content: blocks,
          });
        }
        break;
      }
      case "turn/completed":
        {
          const turn = p.turn ?? p;
          const failed = turn.status === "failed";
          const interrupted = [
            "aborted",
            "cancelled",
            "canceled",
            "interrupted",
          ].includes(String(turn.status ?? "").toLowerCase());
          this.finishActiveTools(
            failed || interrupted
              ? "Tool stopped before completing."
              : "Tool completed.",
            failed || interrupted,
          );
          this.emitEvent({
            type: "result",
            ok: !failed && !interrupted,
            error: failed
              ? String(turn.error?.message ?? turn.error ?? "turn failed")
              : interrupted
                ? "Turn interrupted"
                : undefined,
          });
        }
        this.currentStream = "";
        this.pendingQuestions.clear();
        this.emitEvent({ type: "status", status: "idle" });
        break;
      case "turn/failed":
        this.pendingQuestions.clear();
        this.finishActiveTools("Tool stopped before completing.", true);
        this.emitEvent({
          type: "result",
          ok: false,
          error: String(
            typeof p.error === "string"
              ? p.error
              : (p.error?.message ?? "turn failed"),
          ),
        });
        this.emitEvent({ type: "status", status: "idle" });
        break;
      case "serverRequest/resolved": {
        const resolvedId = String(p.requestId ?? "");
        const pending = [...this.pendingQuestions.entries()].find(
          ([, question]) => String(question.rpcId) === resolvedId,
        );
        if (pending) {
          this.pendingQuestions.delete(pending[0]);
          this.emitEvent({ type: "questionResolved", requestId: pending[0] });
        }
        break;
      }
      case "mcpServer/elicitation/request":
        if (isServerRequest) {
          const requestId = `mcp-${msg.id}`;
          const grant = this.opts?.automationGrant;
          // Codex's own MCP-tool-call approvals (approvalPolicy "untrusted")
          // carry the tool and its params in _meta rather than Executor's
          // "Approve tools.…" phrasing. For granted runs, evaluate the actual
          // execute snippet: every referenced address must be delegated.
          const meta = (p as { _meta?: Record<string, unknown> })?._meta;
          if (grant && meta?.codex_approval_kind === "mcp_tool_call") {
            const params = meta.tool_params as
              Record<string, unknown> | undefined;
            const code = typeof params?.code === "string" ? params.code : "";
            const metadataToolName =
              typeof meta.tool_name === "string"
                ? meta.tool_name
                : typeof meta.toolName === "string"
                  ? meta.toolName
                  : undefined;
            const toolName =
              metadataToolName ??
              (p as { message?: string }).message?.match(
                /run tool ["'`]([^"'`]+)["'`]/i,
              )?.[1] ??
              (code ? "execute" : "");
            const addresses =
              toolName === "execute" ? executorAddressesFromCode(code) : [];
            const readOnlyCatalog = [
              "skills",
              "search",
              "describe",
              // Executor's resume tool only continues the immediately prior
              // call. The original execute snippet has already been checked
              // against this automation's narrow grant.
              "resume",
            ].includes(toolName);
            const catalogDiscovery =
              toolName === "execute" &&
              executorCodeUsesOnlyCatalogHelpers(code);
            const allowed =
              readOnlyCatalog ||
              catalogDiscovery ||
              (toolName === "execute" &&
                addresses.length > 0 &&
                addresses.every((address) =>
                  grantAllowsAddress(grant.toolPatterns, address),
                ));
            if (allowed) {
              this.write({
                jsonrpc: "2.0",
                id: msg.id,
                result: { action: "accept", content: {} },
              });
            } else {
              const blockedAddress =
                addresses.find(
                  (address) => !grantAllowsAddress(grant.toolPatterns, address),
                ) ?? toolName;
              this.emitEvent({
                type: "permission",
                requestId,
                toolName: blockedAddress || "Executor tool",
                input: p,
              });
              this.write({
                jsonrpc: "2.0",
                id: msg.id,
                result: { action: "decline" },
              });
            }
            return;
          }
          const address = executorAddressFromElicitation(p);
          if (grant && grantAllowsAddress(grant.toolPatterns, address)) {
            this.write({
              jsonrpc: "2.0",
              id: msg.id,
              result: { action: "accept", content: {} },
            });
          } else {
            this.emitEvent({
              type: "permission",
              requestId,
              toolName: address ?? "Executor tool",
              input: p,
            });
            if (grant) {
              this.write({
                jsonrpc: "2.0",
                id: msg.id,
                result: { action: "decline" },
              });
            } else {
              this.approvals.set(requestId, { rpcId: msg.id!, kind: "mcp" });
              this.emitEvent({ type: "status", status: "waiting" });
            }
          }
        }
        break;
      case "item/tool/call":
        // Unknown dynamic tools are client-executed RPC requests. An explicit
        // response is essential; silently ignoring one leaves the turn hung.
        if (isServerRequest) {
          this.write({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              success: false,
              contentItems: [
                {
                  type: "inputText",
                  text: "This client only supports configured MCP tools.",
                },
              ],
            },
          });
        }
        break;
      case "error":
      case "codex/event/error": {
        const error = p.error ?? p.event?.error ?? p.message ?? p;
        this.finishActiveTools(
          "Tool stopped because the agent encountered an error.",
          true,
        );
        this.emitEvent({
          type: "error",
          message:
            typeof error === "string"
              ? error
              : String(error?.message ?? JSON.stringify(error)),
        });
        this.emitEvent({ type: "status", status: "idle" });
        break;
      }
    }
  }

  private itemToBlocks(item: Record<string, any>): ContentBlock[] {
    switch (item.type) {
      case "agentMessage":
      case "agent_message": {
        const text =
          typeof item.text === "string"
            ? item.text
            : typeof item.content === "string"
              ? item.content
              : this.currentStream;
        this.currentStream = "";
        return text ? [{ type: "text", text }] : [];
      }
      case "reasoning": {
        const text =
          typeof item.text === "string"
            ? item.text
            : typeof item.summary === "string"
              ? item.summary
              : Array.isArray(item.summary)
                ? item.summary.map((part: any) => part?.text ?? "").join("\n")
                : "";
        return text ? [{ type: "thinking", thinking: text }] : [];
      }
      case "commandExecution":
      case "command_execution": {
        const id = String(item.id ?? this.rpcId++);
        const blocks: ContentBlock[] = [
          {
            type: "tool_use",
            id,
            name: "bash",
            input: { command: item.command },
          },
        ];
        // Completed executions carry their output; surface it so the UI can
        // render a real terminal view instead of a spinner.
        const output =
          item.output ?? item.aggregatedOutput ?? item.aggregated_output;
        const exitCode = item.exitCode ?? item.exit_code;
        blocks.push({
          type: "tool_result",
          tool_use_id: id,
          content:
            typeof output === "string" && output.trim()
              ? output
              : `Command completed${typeof exitCode === "number" ? ` with exit code ${exitCode}` : ""}.`,
          is_error: typeof exitCode === "number" && exitCode !== 0,
        });
        return blocks;
      }
      case "fileChange":
      case "file_change": {
        const id = String(item.id ?? this.rpcId++);
        return [
          {
            type: "tool_use",
            id,
            name: "editFile",
            input: {
              file: item.filePath ?? item.file,
              changes: item.changes,
            },
          },
          {
            type: "tool_result",
            tool_use_id: id,
            content:
              item.diff ??
              `Updated ${item.filePath ?? item.file ?? "workspace files"}.`,
          },
        ];
      }
      case "mcpToolCall":
      case "mcp_tool_call": {
        const id = String(item.id ?? this.rpcId++);
        const result = this.extractMcpResult(item);
        const status = String(item.status ?? "").toLowerCase();
        const failed =
          Boolean(item.error) ||
          [
            "failed",
            "aborted",
            "cancelled",
            "canceled",
            "declined",
            "interrupted",
          ].includes(status);
        this.activeToolUseIds.delete(id);
        return [
          {
            type: "tool_result",
            tool_use_id: id,
            content:
              result ||
              (failed ? "Tool stopped before completing." : "Tool completed."),
            is_error: failed,
          },
        ];
      }
      case "webSearch":
      case "web_search": {
        const id = String(item.id ?? this.rpcId++);
        this.activeToolUseIds.delete(id);
        return [
          {
            type: "tool_result",
            tool_use_id: id,
            content:
              item.result ??
              item.output ??
              (item.query ? `Searched for ${item.query}` : "Search complete"),
          },
        ];
      }
      default:
        return [];
    }
  }

  private itemStartedToBlocks(item: Record<string, any>): ContentBlock[] {
    if (item.type === "commandExecution" || item.type === "command_execution") {
      return [
        {
          type: "tool_use",
          id: String(item.id ?? this.rpcId++),
          name: "bash",
          input: { command: item.command ?? "" },
        },
      ];
    }
    if (item.type === "fileChange" || item.type === "file_change") {
      return [
        {
          type: "tool_use",
          id: String(item.id ?? this.rpcId++),
          name: "editFile",
          input: { file: item.filePath ?? item.file ?? "" },
        },
      ];
    }
    if (
      item.type === "mcpToolCall" ||
      item.type === "mcp_tool_call" ||
      item.type === "webSearch" ||
      item.type === "web_search"
    ) {
      const id = String(item.id ?? this.rpcId++);
      this.activeToolUseIds.add(id);
      const isSearch = item.type === "webSearch" || item.type === "web_search";
      return [
        {
          type: "tool_use",
          id,
          name: isSearch ? "web_search" : String(item.tool ?? "tool"),
          input: isSearch
            ? { query: item.query ?? item.action?.query ?? "" }
            : (item.arguments ?? item.input ?? {}),
        },
      ];
    }
    return [];
  }

  private extractMcpResult(item: Record<string, any>): string {
    return codexMcpResultText(item);
  }

  async sendPrompt(text: string): Promise<void> {
    await this.rpc("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text }],
    });
  }

  override respondPermission(requestId: string, behavior: "allow" | "deny") {
    const pending = this.approvals.get(requestId);
    if (!pending) return;
    this.approvals.delete(requestId);
    this.write({
      jsonrpc: "2.0",
      id: pending.rpcId,
      result:
        pending.kind === "mcp"
          ? { action: behavior === "allow" ? "accept" : "decline", content: {} }
          : { decision: behavior === "allow" ? "accept" : "decline" },
    });
    this.emitEvent({ type: "status", status: "running" });
  }

  override respondQuestion(
    requestId: string,
    answers: Record<string, string> | null,
  ) {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending) return;
    this.pendingQuestions.delete(requestId);
    this.write({
      jsonrpc: "2.0",
      id: pending.rpcId,
      result: {
        answers: Object.fromEntries(
          pending.questions.flatMap((question) => {
            const answer = answers?.[question.question]?.trim();
            if (!answer) return [];
            const values = answer
              .split(", ")
              .map((value) =>
                question.optionLabels.has(value)
                  ? value
                  : `user_note: ${value}`,
              );
            return [[question.id, { answers: values }]];
          }),
        ),
      },
    });
    this.emitEvent({ type: "questionResolved", requestId });
    this.emitEvent({ type: "status", status: "running" });
  }

  async interrupt(): Promise<void> {
    if (this.threadId && this.turnId) {
      await this.rpc("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.turnId,
      }).catch(() => {});
    }
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.stopping = true;
    this.proc = null;
    this.rejectPending("Codex stopped");
    proc.stdin?.end();
    const pid = proc.pid;
    if (!pid) return;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }
    const force = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
    }, 2_000);
    force.unref();
  }

  private rpc(
    method: string,
    params: unknown,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    const id = ++this.rpcId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id))
          reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private rejectPending(reason: string) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private notify(method: string, params: unknown) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(obj: unknown) {
    this.proc?.stdin?.write(JSON.stringify(obj) + "\n");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function codexMcpResultText(item: Record<string, unknown>): string {
  if (item.error) {
    return `Error: ${typeof item.error === "string" ? item.error : JSON.stringify(item.error)}`;
  }
  const result = record(item.result);
  if (result?.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent, null, 2);
  }
  if (Array.isArray(result?.content)) {
    return result.content
      .map((part) => {
        const value = record(part);
        return typeof part === "string"
          ? part
          : typeof value?.text === "string"
            ? value.text
            : JSON.stringify(part);
      })
      .join("\n");
  }
  const value = item.result ?? item.output ?? item.content;
  return value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
}
