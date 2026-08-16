import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

import type { ContentBlock, StartOptions } from "../types.js";
import type { OpenCodeTerminalState } from "./opencode-support.js";
import { BaseDriver } from "./base.js";
import { agentEnvironment } from "./environment.js";
import {
  findOpenCode,
  initializeOpenCodeSession,
  openCodeConfigContent,
  OpenCodeHostServices,
  openCodeRecord as record,
  openCodeTextContent as textContent,
} from "./opencode-support.js";

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

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
  private terminals = new Map<string, OpenCodeTerminalState>();
  private stream = "";
  private thinking = "";
  private stopping = false;
  private access: StartOptions["access"] = "guarded";
  private cwd = homedir();
  private environment: NodeJS.ProcessEnv = { ...process.env };
  private readonly hostServices = new OpenCodeHostServices({
    cwd: () => this.cwd,
    environment: () => this.environment,
    respond: (id, result) => this.respond(id, result),
    terminals: this.terminals,
  });
  private suppressReplay = false;

  async start(options: StartOptions) {
    this.startOptions = options;
    this.stopping = false;
    this.access = options.access;
    this.cwd = options.cwd;
    this.sessionId = options.resumeSessionId;
    this.suppressReplay = true;
    this.buffer = "";
    writeFileSync(join(options.cwd, "AGENTS.md"), options.instructions);
    const env = agentEnvironment(options.env);
    this.environment = env;
    // Never let a repo command block on an interactive prompt (git credentials,
    // pager, etc.) — that is what made agents look stuck mid-`Run`. Fail fast
    // so the model sees an error and can adapt instead of hanging forever.
    env.GIT_TERMINAL_PROMPT = "0";
    env.GIT_ASKPASS = "/bin/true";
    env.GIT_PAGER = "cat";
    env.PAGER = "cat";
    env.OPENCODE_CONFIG_CONTENT = openCodeConfigContent(
      options,
      env.OPENCODE_CONFIG_CONTENT,
    );
    const child = spawn(findOpenCode(), ["acp"], {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    this.process = child;
    child.stdout.on("data", (chunk) => {
      if (this.process === child) this.consume(String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      if (this.process !== child) return;
      const message = String(chunk).trim();
      if (message) console.error(`[opencode] ${message.slice(0, 800)}`);
    });
    child.on("error", (error) => {
      if (this.process !== child) return;
      if (this.pending.size > 0) {
        this.rejectPending(error.message);
        return;
      }
      this.emitEvent({ type: "error", message: error.message });
    });
    child.on("exit", (code) => {
      // A forced retry can overlap the old process exit with initialization of
      // the replacement. Ignore every stale callback from the old generation.
      if (this.process !== child) return;
      this.process = null;
      const hadPending = this.pending.size > 0;
      this.rejectPending("OpenCode exited.");
      this.permissions.clear();
      this.activeTools.clear();
      // A pending prompt is still owned by BaseDriver while it retries. Do not
      // mark the chat idle or release its execution lock between attempts.
      if (hadPending && !this.promptWasInterrupted()) return;
      if (!this.stopping && !this.promptWasInterrupted() && code !== 0) {
        this.emitEvent({
          type: "error",
          message: `OpenCode exited unexpectedly${code === null ? "." : ` with code ${code}.`}`,
        });
      }
      this.emitEvent({ type: "exit", code });
      this.emitEvent({ type: "status", status: "idle" });
    });

    const initialized = await initializeOpenCodeSession(
      options,
      this.sessionId,
      (method, params) => this.rpc(method, params),
    );
    this.sessionId = initialized.sessionId;
    this.emitEvent({
      type: "init",
      sessionId: initialized.sessionId,
      model: initialized.model,
    });
    this.emitEvent({ type: "status", status: "idle" });
  }

  async sendPromptOnce(text: string) {
    if (!this.sessionId) throw new Error("OpenCode session is not ready.");
    await this.restartIfNeeded();
    // A real prompt is running now; anything opencode streams belongs to it.
    this.suppressReplay = false;
    this.stream = "";
    this.thinking = "";
    this.activeTools.clear();
    this.emitEvent({ type: "status", status: "running" });
    let completed = false;
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
      if (this.stream) {
        content.push({ type: "text", text: this.stream });
      }
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
      completed = true;
    } finally {
      this.stream = "";
      this.thinking = "";
      // Keep the session busy while BaseDriver backs off and retries a thrown
      // transport failure. Only a terminal attempt should release execution.
      if (completed) this.emitEvent({ type: "status", status: "idle" });
    }
  }

  async interrupt() {
    this.interrupted = true;
    // A hung child command is the usual reason an agent looks stuck; kill the
    // terminals too so SIGINT to the host actually frees the turn.
    for (const terminal of this.terminals.values()) {
      terminal.process.kill("SIGKILL");
    }
    this.process?.kill("SIGINT");
  }

  async restart(): Promise<void> {
    const options = this.startOptions;
    if (!options) throw new Error("OpenCode session is not ready.");
    this.terminateProcess("OpenCode is restarting.");
    await this.start({ ...options, resumeSessionId: this.sessionId });
  }

  private async restartIfNeeded() {
    if (this.process?.stdin && this.process.exitCode === null) return;
    this.process = null;
    if (!this.startOptions) {
      throw new Error("OpenCode session is not ready.");
    }
    await this.start({
      ...this.startOptions,
      resumeSessionId: this.sessionId,
    });
  }

  async stop() {
    this.stopping = true;
    this.terminateProcess("OpenCode stopped.");
  }

  private terminateProcess(reason: string) {
    this.permissions.clear();
    this.activeTools.clear();
    for (const terminal of this.terminals.values()) {
      if (terminal.pendingWaitTimer) clearTimeout(terminal.pendingWaitTimer);
      terminal.pendingWaitId = undefined;
      terminal.pendingWaitTimer = undefined;
      terminal.process.kill("SIGTERM");
    }
    this.terminals.clear();
    const child = this.process;
    this.process = null;
    this.rejectPending(reason);
    const pid = child?.pid;
    if (pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      const force = setTimeout(() => {
        if (child.exitCode !== null) return;
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 2_000);
      force.unref();
      child.once("exit", () => clearTimeout(force));
    }
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
      this.hostServices.readFile(id, params);
    } else if (method === "fs/write_text_file" && id !== undefined) {
      this.hostServices.writeFile(id, params);
    } else if (method.startsWith("terminal/") && id !== undefined) {
      this.hostServices.terminal(id, method, params);
    }
  }

  private sessionUpdate(params: Record<string, unknown>) {
    const update = record(params.update ?? params);
    const type = update.type ?? update.sessionUpdate;
    if (
      this.suppressReplay &&
      (type === "agent_message_chunk" ||
        type === "agent_thought_chunk" ||
        type === "tool_call" ||
        type === "tool_call_start" ||
        type === "tool_call_update" ||
        type === "tool_call_end")
    ) {
      return;
    }
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
    // An empty input object can shadow the raw code the model wrote (opencode
    // reports both). Prefer the raw code so the UI can label the actual tool
    // the agent called instead of a generic "Run connected tool".
    if (
      (!input ||
        (typeof input === "object" &&
          !Array.isArray(input) &&
          Object.keys(input).length === 0)) &&
      typeof update.rawInput === "string" &&
      update.rawInput.trim()
    ) {
      input = { code: update.rawInput };
    }
    if (process.env.CHIEF_DEBUG_SESSION_FORCE === "1") {
      console.error(
        `[opencode-tool] ${eventType} name=${name} id=${id} inputKeys=${JSON.stringify(
          Object.keys(update),
        )} nestedKeys=${JSON.stringify(Object.keys(nested))} input=${JSON.stringify(
          input,
        ).slice(0, 300)}`,
      );
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
      this.process.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  private respond(id: number | string, result: unknown) {
    this.process?.stdin?.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`,
    );
  }

  private rejectPending(message: string) {
    for (const request of this.pending.values()) {
      if (request.timer) clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }
}
