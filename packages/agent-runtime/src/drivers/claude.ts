import { randomUUID } from "node:crypto";
import type {
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";

import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import type { AgentQuestion, ContentBlock, StartOptions } from "../types.js";
import { evaluateToolUse } from "../approvals.js";
import { BaseDriver } from "./base.js";
import { agentEnvironment } from "./environment.js";

function parseQuestions(input: Record<string, unknown>): AgentQuestion[] {
  if (!Array.isArray(input.questions)) return [];
  return input.questions.flatMap((candidate) => {
    if (!candidate || !isJsonObject(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (!isJsonString(item.question) || !Array.isArray(item.options)) {
      return [];
    }
    const options = item.options.flatMap((option) => {
      if (!option || !isJsonObject(option)) return [];
      const record = option as Record<string, unknown>;
      return isJsonString(record.label)
        ? [
            {
              label: record.label,
              description: isJsonString(record.description)
                ? record.description
                : undefined,
            },
          ]
        : [];
    });
    if (options.length === 0) return [];
    return [
      {
        question: item.question,
        header: isJsonString(item.header) ? item.header : undefined,
        multiSelect: item.multiSelect === true,
        options,
      },
    ];
  });
}

/**
 * Drives Claude Code via the official Agent SDK. The SDK spawns the local
 * `claude` binary, so auth comes from the user's ~/.claude login and
 * inference bills to their existing subscription.
 */
export class ClaudeDriver extends BaseDriver {
  protected override promptCompletesFromEvents = true;
  private q: Query | null = null;
  private sessionId: string | undefined;
  private abort = new AbortController();
  private inputQueue: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  private pendingApprovals = new Map<
    string,
    (behavior: "allow" | "deny") => void
  >();
  private pendingQuestions = new Map<
    string,
    (answers: Record<string, string> | null) => void
  >();
  private access: StartOptions["access"] = "guarded";
  private generation = 0;

  async start(opts: StartOptions): Promise<void> {
    this.startOptions = opts;
    this.sessionId = opts.resumeSessionId;
    this.access = opts.access;
    this.closed = false;
    if (this.abort.signal.aborted) this.abort = new AbortController();

    const driver = this;
    async function* input(): AsyncGenerator<SDKUserMessage> {
      while (!driver.closed) {
        while (driver.inputQueue.length > 0) {
          yield driver.inputQueue.shift()!;
        }
        await new Promise<void>((resolve) => (driver.wake = resolve));
      }
    }

    // Strip nested-session markers so the CLI doesn't think it's running
    // inside another Claude Code session (matters when the service itself
    // was launched from one).
    const env = agentEnvironment(opts.env);
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.CLAUDE_CODE_SESSION_ID;

    const activeQuery = query({
      prompt: input(),
      options: {
        env,
        cwd: opts.cwd,
        model: opts.model,
        mcpServers: Object.fromEntries(
          (opts.mcpServers ?? []).map((server) => [
            server.name,
            server.url
              ? {
                  type: "http" as const,
                  url: server.url,
                  headers: server.headers ?? {},
                }
              : {
                  type: "stdio" as const,
                  command: server.command,
                  args: server.args,
                  ...(server.cwd ? { cwd: server.cwd } : undefined),
                  env: server.env ?? {},
                },
          ]),
        ),
        resume: this.sessionId,
        includePartialMessages: true,
        // canUseTool is always registered: it is also how AskUserQuestion
        // answers reach the model. Full-access sessions auto-allow every
        // other tool (installs, browser opens and callback servers just
        // work); guarded sessions route mutations through the approval
        // policy.
        canUseTool: (toolName: string, toolInput: Record<string, unknown>) =>
          this.decideToolUse(opts.cwd, toolName, toolInput),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: opts.instructions,
        },
        abortController: this.abort,
      },
    });
    this.q = activeQuery;
    const generation = ++this.generation;
    void this.pump(activeQuery, generation);
  }

  private async pump(activeQuery: Query, generation: number) {
    try {
      for await (const msg of activeQuery) {
        if (generation !== this.generation) return;
        this.handle(msg);
      }
    } catch (err) {
      if (!this.closed && generation === this.generation) {
        this.emitEvent({ type: "error", message: String(err) });
      }
    }
    if (generation === this.generation) {
      this.emitEvent({ type: "exit", code: 0 });
    }
  }

  private handle(msg: SDKMessage) {
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          this.sessionId = msg.session_id;
          this.emitEvent({
            type: "init",
            sessionId: msg.session_id,
            model: msg.model,
          });
        }
        break;
      case "stream_event": {
        const ev = msg.event;
        if (
          ev.type === "content_block_delta" &&
          ev.delta.type === "text_delta"
        ) {
          this.emitEvent({ type: "stream", text: ev.delta.text });
        }
        break;
      }
      case "assistant": {
        const blocks: ContentBlock[] = [];
        for (const block of msg.message.content) {
          if (block.type === "text") {
            blocks.push({ type: "text", text: block.text });
          } else if (block.type === "thinking") {
            blocks.push({ type: "thinking", thinking: block.thinking });
          } else if (block.type === "tool_use") {
            blocks.push({
              type: "tool_use",
              id: block.id,
              name: block.name.replace(/^mcp__[^_]+__/, ""),
              input: block.input,
            });
          }
        }
        if (blocks.length > 0) {
          this.emitEvent({
            type: "message",
            role: "assistant",
            content: blocks,
          });
        }
        break;
      }
      case "user": {
        const blocks: ContentBlock[] = [];
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              blocks.push({
                type: "tool_result",
                tool_use_id: block.tool_use_id,
                content: block.content,
                is_error: block.is_error,
              });
            }
          }
        }
        if (blocks.length > 0) {
          this.emitEvent({ type: "message", role: "user", content: blocks });
        }
        break;
      }
      case "result":
        this.emitEvent({
          type: "result",
          ok: msg.subtype === "success",
          costUsd: msg.total_cost_usd,
          durationMs: msg.duration_ms,
          error: msg.subtype === "success" ? undefined : msg.subtype,
        });
        this.emitEvent({ type: "status", status: "idle" });
        break;
    }
  }

  private decideToolUse(
    cwd: string,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<PermissionResult> {
    if (toolName === "AskUserQuestion") {
      return this.requestAnswers(toolInput);
    }
    if (this.access === "full") {
      return Promise.resolve({ behavior: "allow", updatedInput: toolInput });
    }
    return this.requestApproval(cwd, toolName, toolInput);
  }

  /**
   * AskUserQuestion is answered, not approved: the UI collects the user's
   * choices and they return to the model through updatedInput.answers.
   */
  private requestAnswers(
    toolInput: Record<string, unknown>,
  ): Promise<PermissionResult> {
    const questions = parseQuestions(toolInput);
    if (questions.length === 0) {
      return Promise.resolve({
        behavior: "deny",
        message: "The question payload was malformed; ask again in plain text.",
      });
    }
    const requestId = randomUUID();
    return new Promise<PermissionResult>((resolve) => {
      this.pendingQuestions.set(requestId, (answers) => {
        this.emitEvent({ type: "questionResolved", requestId });
        this.emitEvent({ type: "status", status: "running" });
        resolve(
          answers
            ? { behavior: "allow", updatedInput: { ...toolInput, answers } }
            : {
                behavior: "deny",
                message:
                  "The user dismissed the questions. Continue with your best judgment.",
              },
        );
      });
      this.emitEvent({ type: "question", requestId, questions });
      this.emitEvent({ type: "status", status: "waiting" });
    });
  }

  private requestApproval(
    cwd: string,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<PermissionResult> {
    if (evaluateToolUse(toolName, toolInput, cwd) === "allow") {
      return Promise.resolve({
        behavior: "allow",
        updatedInput: toolInput,
      });
    }

    const requestId = randomUUID();
    return new Promise<PermissionResult>((resolve) => {
      this.pendingApprovals.set(requestId, (behavior) => {
        resolve(
          behavior === "allow"
            ? { behavior: "allow", updatedInput: toolInput }
            : {
                behavior: "deny",
                message: "The user declined this action.",
              },
        );
      });
      this.emitEvent({
        type: "permission",
        requestId,
        toolName,
        input: toolInput,
      });
      this.emitEvent({ type: "status", status: "waiting" });
    });
  }

  override respondPermission(requestId: string, behavior: "allow" | "deny") {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;
    this.pendingApprovals.delete(requestId);
    pending(behavior);
    this.emitEvent({ type: "status", status: "running" });
  }

  override respondQuestion(
    requestId: string,
    answers: Record<string, string> | null,
  ) {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending) return;
    this.pendingQuestions.delete(requestId);
    pending(answers);
  }

  async sendPromptOnce(text: string): Promise<void> {
    this.inputQueue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? "",
    });
    this.emitEvent({ type: "status", status: "running" });
    this.wake?.();
  }

  /** Recover from a failed prompt by restarting the Claude SDK session. */
  async restart(): Promise<void> {
    const options = this.startOptions;
    if (!options) return;
    const previous = this.q;
    this.generation += 1;
    this.closed = true;
    this.wake?.();
    this.abort.abort();
    await previous?.interrupt().catch(() => undefined);
    this.q = null;
    this.inputQueue = [];
    this.wake = null;
    this.pendingApprovals.clear();
    this.pendingQuestions.clear();
    this.abort = new AbortController();
    this.closed = false;
    await this.start({ ...options, resumeSessionId: this.sessionId });
  }

  async interrupt(): Promise<void> {
    this.interrupted = true;
    await this.q?.interrupt();
    this.emitEvent({ type: "status", status: "idle" });
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.closed = true;
    this.wake?.();
    this.abort.abort();
    await this.q?.interrupt().catch(() => undefined);
    this.q = null;
  }
}
