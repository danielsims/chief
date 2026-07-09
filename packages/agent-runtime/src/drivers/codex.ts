import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BaseDriver } from "./base.js";
import type { ContentBlock, StartOptions } from "../types.js";

function findCodex(): string {
  if (process.env.CODEX_PATH) return process.env.CODEX_PATH;
  for (const p of [
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
  private approvals = new Map<string, number>();
  private opts: StartOptions | null = null;

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
    this.proc = spawn(findCodex(), ["app-server"], {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.on("exit", (code) => this.emitEvent({ type: "exit", code }));
    this.proc.on("error", (err) =>
      this.emitEvent({ type: "error", message: err.message }),
    );

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

    if (this.threadId) {
      const res = await this.rpc("thread/resume", { threadId: this.threadId });
      this.threadId = threadIdOf(res) ?? this.threadId;
    } else {
      const params: Record<string, unknown> = {
        cwd: opts.cwd,
        approvalPolicy: "on-failure",
        sandbox: "workspace-write",
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
    this.emitEvent({ type: "init", sessionId: this.threadId!, model: opts.model });
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
        if (msg.error) req.reject(new Error(msg.error.message));
        else req.resolve(msg.result);
      }
      return;
    }

    const p = (msg.params ?? {}) as Record<string, any>;

    // Server -> client approval requests (RPC with id)
    if (
      msg.id !== undefined &&
      (msg.method === "item/commandExecution/requestApproval" ||
        msg.method === "item/fileChange/requestApproval")
    ) {
      const requestId = `codex-${msg.id}`;
      this.approvals.set(requestId, msg.id);
      this.emitEvent({
        type: "permission",
        requestId,
        toolName: msg.method.includes("command") ? "bash" : "fileChange",
        input: p,
      });
      return;
    }

    switch (msg.method) {
      case "turn/started":
        this.turnId = p.turnId;
        this.emitEvent({ type: "status", status: "running" });
        break;
      case "item/agentMessage/delta":
        if (typeof p.delta === "string") {
          this.emitEvent({ type: "stream", text: p.delta });
        }
        break;
      case "item/completed": {
        const item = p.item as Record<string, any> | undefined;
        if (!item) break;
        const blocks = this.itemToBlocks(item);
        if (blocks.length > 0) {
          this.emitEvent({ type: "message", role: "assistant", content: blocks });
        }
        break;
      }
      case "turn/completed":
        this.emitEvent({ type: "result", ok: true });
        this.emitEvent({ type: "status", status: "idle" });
        break;
      case "turn/failed":
        this.emitEvent({
          type: "result",
          ok: false,
          error: String(p.error?.message ?? "turn failed"),
        });
        this.emitEvent({ type: "status", status: "idle" });
        break;
    }
  }

  private itemToBlocks(item: Record<string, any>): ContentBlock[] {
    switch (item.type) {
      case "agentMessage":
        return item.text ? [{ type: "text", text: item.text }] : [];
      case "reasoning":
        return item.text ? [{ type: "thinking", thinking: item.text }] : [];
      case "commandExecution":
        return [
          {
            type: "tool_use",
            id: String(item.id ?? this.rpcId++),
            name: "bash",
            input: { command: item.command },
          },
        ];
      case "fileChange":
        return [
          {
            type: "tool_use",
            id: String(item.id ?? this.rpcId++),
            name: "editFile",
            input: { changes: item.changes },
          },
        ];
      default:
        return [];
    }
  }

  async sendPrompt(text: string): Promise<void> {
    await this.rpc("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text }],
    });
  }

  override respondPermission(requestId: string, behavior: "allow" | "deny") {
    const rpcRequestId = this.approvals.get(requestId);
    if (rpcRequestId === undefined) return;
    this.approvals.delete(requestId);
    this.write({
      jsonrpc: "2.0",
      id: rpcRequestId,
      result: { decision: behavior === "allow" ? "accept" : "decline" },
    });
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
    this.proc?.kill();
  }

  private rpc(method: string, params: unknown): Promise<unknown> {
    const id = ++this.rpcId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`RPC timeout: ${method}`));
      }, 30_000);
    });
  }

  private notify(method: string, params: unknown) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(obj: unknown) {
    this.proc?.stdin?.write(JSON.stringify(obj) + "\n");
  }
}
