import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  isJsonNumber,
  isJsonString,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

import type { ContentBlock, StartOptions } from "../types.js";
import type { AcpRuntimeAdapter, PendingAcpRpc } from "./acp-runtime.js";
import type { OpenCodeTerminalState } from "./opencode-support.js";
import { BaseDriver } from "./base.js";
import { agentEnvironment } from "./environment.js";
import {
  initializeOpenCodeSession,
  OpenCodeHostServices,
  openCodeRecord as record,
  openCodeTextContent as textContent,
} from "./opencode-support.js";

export class AcpDriver extends BaseDriver {
  private process: ChildProcess | null = null;
  private sessionId: string | undefined;
  private buffer = "";
  private nextRpcId = 0;
  private pending = new Map<number | string, PendingAcpRpc>();
  private permissions = new Map<
    string,
    { rpcId: number | string; allow: string; deny: string }
  >();
  private activeTools = new Map<
    string,
    { name: string; input: JsonValue | undefined }
  >();
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

  constructor(private readonly runtime: AcpRuntimeAdapter) {
    super();
  }

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
    env.GIT_TERMINAL_PROMPT = "0";
    env.GIT_ASKPASS = "/bin/true";
    env.GIT_PAGER = "cat";
    env.PAGER = "cat";
    this.runtime.configureEnvironment?.(options, env);
    const child = spawn(this.runtime.command(), this.runtime.args, {
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
      if (message) {
        console.error(`[${this.runtime.name}] ${message.slice(0, 800)}`);
      }
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
      if (this.process !== child) return;
      this.process = null;
      const hadPending = this.pending.size > 0;
      this.rejectPending(`${this.runtime.name} exited.`);
      this.permissions.clear();
      this.activeTools.clear();
      if (hadPending && !this.promptWasInterrupted()) return;
      if (!this.stopping && !this.promptWasInterrupted() && code !== 0) {
        this.emitEvent({
          type: "error",
          message: `${this.runtime.name} exited unexpectedly${code === null ? "." : ` with code ${code}.`}`,
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
    if (!this.sessionId) {
      throw new Error(`${this.runtime.name} session is not ready.`);
    }
    await this.restartIfNeeded();
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
      if (completed) this.emitEvent({ type: "status", status: "idle" });
    }
  }

  interrupt(): Promise<void> {
    this.interrupted = true;
    for (const terminal of this.terminals.values()) {
      terminal.process.kill("SIGKILL");
    }
    this.process?.kill("SIGINT");
    return Promise.resolve();
  }

  async restart(): Promise<void> {
    const options = this.startOptions;
    if (!options) {
      throw new Error(`${this.runtime.name} session is not ready.`);
    }
    this.terminateProcess(`${this.runtime.name} is restarting.`);
    await this.start({ ...options, resumeSessionId: this.sessionId });
  }

  private async restartIfNeeded() {
    if (this.process?.stdin && this.process.exitCode === null) return;
    this.process = null;
    if (!this.startOptions) {
      throw new Error(`${this.runtime.name} session is not ready.`);
    }
    await this.start({
      ...this.startOptions,
      resumeSessionId: this.sessionId,
    });
  }

  stop(): Promise<void> {
    this.stopping = true;
    this.terminateProcess(`${this.runtime.name} stopped.`);
    return Promise.resolve();
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
      outcome: {
        outcome: "selected",
        optionId: behavior === "allow" ? pending.allow : pending.deny,
      },
    });
  }

  private consume(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        const message = parseJsonObject(parsed);
        if (message) this.handle(message);
      } catch {
        continue;
      }
    }
  }

  private handle(message: JsonObject) {
    const id =
      isJsonNumber(message.id) || isJsonString(message.id)
        ? message.id
        : undefined;
    const method = message.method;
    if (id !== undefined && !isJsonString(method)) {
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      if (request.timer) clearTimeout(request.timer);
      const error = record(message.error);
      if (isJsonString(error.message)) {
        request.reject(new Error(error.message));
      } else request.resolve(message.result);
      return;
    }
    if (!isJsonString(method)) return;
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

  private sessionUpdate(params: JsonObject) {
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
      const text =
        textContent(update.content) ||
        (isJsonString(update.text) ? update.text : "");
      this.thinking += text;
      if (text) this.emitEvent({ type: "thinkingStream", text });
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

  private toolUpdate(update: JsonObject, eventType: string) {
    const nested = record(update.toolCall ?? update.tool_call ?? update.tool);
    const id = this.identifier(
      [update.toolCallId, update.tool_call_id, update.id, nested.id],
      randomUUID(),
    );
    const name = this.text(
      [update.title, update.name, update.toolName, nested.name],
      `${this.runtime.name} tool`,
    );
    let input: JsonValue | undefined =
      update.input ?? update.rawInput ?? update.arguments ?? nested.input ?? {};
    if (isJsonString(input)) {
      const inputText = input;
      try {
        const parsed: unknown = JSON.parse(inputText);
        input = parseJsonValue(parsed);
      } catch {
        input = { value: inputText };
      }
    }
    const inputObject = parseJsonObject(input);
    if (
      (input === undefined ||
        (inputObject && Object.keys(inputObject).length === 0)) &&
      isJsonString(update.rawInput) &&
      update.rawInput.trim()
    ) {
      input = { code: update.rawInput };
    }
    if (process.env.CHIEF_DEBUG_SESSION_FORCE === "1") {
      console.error(
        `[${this.runtime.name}-tool] ${eventType} name=${name} id=${id} inputKeys=${JSON.stringify(
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
    const status = (
      isJsonString(update.status) ? update.status : ""
    ).toLowerCase();
    const complete =
      eventType === "tool_call_end" ||
      status === "completed" ||
      status === "failed";
    if (!complete) return;
    const failed = status === "failed";
    const content = failed
      ? this.text([update.error, update.message], "Tool call failed")
      : textContent(update.content) ||
        (isJsonString(update.result)
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

  private permission(id: number | string, params: JsonObject) {
    const options = Array.isArray(params.options)
      ? params.options.flatMap((option) => {
          const parsed = parseJsonObject(option);
          return parsed ? [parsed] : [];
        })
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
    const allowId = this.identifier([allow?.optionId, allow?.id], "allow-once");
    const denyId = this.identifier([deny?.optionId, deny?.id], "reject-once");
    if (this.access === "full") {
      this.respond(id, {
        outcome: { outcome: "selected", optionId: allowId },
      });
      return;
    }
    const toolCall = record(params.toolCall);
    const toolCallId = this.identifier([toolCall.toolCallId, toolCall.id], "");
    const activeTool = this.activeTools.get(toolCallId);
    const requestId = randomUUID();
    this.permissions.set(requestId, {
      rpcId: id,
      allow: allowId,
      deny: denyId,
    });
    this.emitEvent({
      type: "permission",
      requestId,
      toolName:
        activeTool?.name ??
        this.text(
          [toolCall.name, params.toolName, params.title],
          `${this.runtime.name} tool`,
        ),
      input:
        activeTool?.input ??
        toolCall.input ??
        params.input ??
        params.description ??
        {},
    });
    this.emitEvent({ type: "status", status: "waiting" });
  }

  private rpc(method: string, params: JsonObject, timeoutMs = 30_000) {
    return new Promise<JsonValue | undefined>((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error(`${this.runtime.name} is not running.`));
        return;
      }
      const id = ++this.nextRpcId;
      const pending: PendingAcpRpc = { resolve, reject };
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

  private respond(id: number | string, result: JsonValue | undefined) {
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

  private identifier(
    values: (JsonValue | undefined)[],
    fallback: string,
  ): string {
    const value = values.find(
      (candidate) => isJsonString(candidate) || isJsonNumber(candidate),
    );
    return isJsonString(value) || isJsonNumber(value)
      ? String(value)
      : fallback;
  }

  private text(values: (JsonValue | undefined)[], fallback: string): string {
    return values.find(isJsonString) ?? fallback;
  }
}
