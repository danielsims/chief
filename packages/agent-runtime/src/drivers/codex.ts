import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseDriver } from "./base.js";
import type { ContentBlock, StartOptions } from "../types.js";
import {
  executorAddressFromElicitation,
  grantAllowsAddress,
} from "../recurring-work.js";

function findCodex(): string {
  if (process.env.CODEX_PATH) return process.env.CODEX_PATH;
  const packageCodex = join(
    dirname(fileURLToPath(import.meta.url)),
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
  private activeToolUseIds = new Set<string>();
  private currentStream = "";
  private opts: StartOptions | null = null;
  private stopping = false;

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
    this.proc = spawn(findCodex(), ["app-server"], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, CODEX_HOME: codexHome },
      stdio: ["pipe", "pipe", "pipe"],
      // A process group lets stop() terminate Codex and every MCP child it
      // spawned. Killing only the wrapper leaks app-server/Executor processes.
      detached: true,
    });

    this.proc.on("exit", (code) => {
      this.rejectPending("Codex exited");
      if (!this.stopping && code !== 0) {
        this.emitEvent({
          type: "error",
          message: `Codex exited unexpectedly${code === null ? "." : ` with code ${code}.`}`,
        });
      }
      this.emitEvent({ type: "exit", code });
      this.emitEvent({ type: "status", status: "idle" });
    });
    this.proc.on("error", (err) =>
      this.emitEvent({ type: "error", message: err.message }),
    );
    // Codex writes diagnostics to stderr. Always drain it so a full pipe can
    // never stall the app-server while a turn is streaming.
    this.proc.stderr?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) console.error(`[codex] ${text.slice(0, 800)}`);
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

    await this.rpc("initialize", {
      clientInfo: { name: "marketer", version: "0.1.0" },
    });
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
      sessionId: this.threadId!,
      model: opts.model,
    });
  }

  private prepareCodexHome(opts: StartOptions) {
    const safeName = opts.cwd.replace(/[^a-z0-9_-]/gi, "-").slice(-80);
    const target = join(homedir(), ".marketer", "codex", safeName);
    mkdirSync(target, { recursive: true });
    const userHome = join(homedir(), ".codex");
    const auth = join(userHome, "auth.json");
    if (existsSync(auth)) copyFileSync(auth, join(target, "auth.json"));

    // Reuse the user's transcript store so persisted thread ids can resume,
    // while keeping Marketer's MCP configuration isolated from global Codex.
    for (const name of ["sessions", "session_index.jsonl"]) {
      const source = join(userHome, name);
      const destination = join(target, name);
      if (existsSync(source) && !existsSync(destination)) {
        try {
          symlinkSync(source, destination);
        } catch {
          // A concurrent session may have created it first.
        }
      }
    }

    const lines: string[] = [];
    const model = opts.model ?? this.readUserCodexSetting("model");
    if (model) lines.push(`model = ${JSON.stringify(model)}`);
    lines.push('model_reasoning_effort = "medium"');
    for (const server of opts.mcpServers ?? []) {
      lines.push("", `[mcp_servers.${server.name}]`);
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
      return config.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
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
          this.emitEvent({
            type: "result",
            ok: !failed,
            error: failed
              ? String(turn.error?.message ?? turn.error ?? "turn failed")
              : undefined,
          });
        }
        this.currentStream = "";
        this.emitEvent({ type: "status", status: "idle" });
        break;
      case "turn/failed":
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
      case "mcpServer/elicitation/request":
        if (isServerRequest) {
          const requestId = `mcp-${msg.id}`;
          const address = executorAddressFromElicitation(p);
          const grant = this.opts?.automationGrant;
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
        this.activeToolUseIds.delete(id);
        return result === ""
          ? []
          : [
              {
                type: "tool_result",
                tool_use_id: id,
                content: result,
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
    if (item.error) {
      return `Error: ${typeof item.error === "string" ? item.error : JSON.stringify(item.error)}`;
    }
    const content = item.result?.content;
    if (Array.isArray(content)) {
      return content
        .map((part) =>
          typeof part === "string"
            ? part
            : typeof part?.text === "string"
              ? part.text
              : JSON.stringify(part),
        )
        .join("\n");
    }
    if (item.result?.structuredContent) {
      return JSON.stringify(item.result.structuredContent, null, 2);
    }
    const value = item.result ?? item.output ?? item.content;
    return value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
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

  private rpc(method: string, params: unknown): Promise<unknown> {
    const id = ++this.rpcId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id))
          reject(new Error(`RPC timeout: ${method}`));
      }, 30_000);
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
