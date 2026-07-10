import {
  query,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { BaseDriver } from "./base.js";
import { evaluateToolUse } from "../approvals.js";
import type { ContentBlock, StartOptions } from "../types.js";

/**
 * Drives Claude Code via the official Agent SDK. The SDK spawns the local
 * `claude` binary, so auth comes from the user's ~/.claude login and
 * inference bills to their existing subscription.
 */
export class ClaudeDriver extends BaseDriver {
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

  async start(opts: StartOptions): Promise<void> {
    this.sessionId = opts.resumeSessionId;

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
    const env = { ...process.env, ...opts.env } as Record<string, string>;
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.CLAUDE_CODE_SESSION_ID;

    this.q = query({
      prompt: input(),
      options: {
        env,
        cwd: opts.cwd,
        model: opts.model,
        mcpServers: Object.fromEntries(
          (opts.mcpServers ?? []).map((server) => [
            server.name,
            {
              type: "stdio" as const,
              command: server.command,
              args: server.args,
              env: server.env ?? {},
            },
          ]),
        ),
        resume: this.sessionId,
        includePartialMessages: true,
        // Guarded sessions route mutating tool calls through the approval
        // policy. Full-access sessions (user-initiated setup runs) skip it so
        // installs, browser opens and callback servers just work.
        ...(opts.access === "full"
          ? {
              permissionMode: "bypassPermissions" as const,
              allowDangerouslySkipPermissions: true,
            }
          : {
              canUseTool: (
                toolName: string,
                toolInput: Record<string, unknown>,
              ) => this.requestApproval(opts.cwd, toolName, toolInput),
            }),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: opts.instructions,
        },
        abortController: this.abort,
      },
    });

    void this.pump();
  }

  private async pump() {
    if (!this.q) return;
    try {
      for await (const msg of this.q) {
        this.handle(msg);
      }
    } catch (err) {
      if (!this.closed) {
        this.emitEvent({ type: "error", message: String(err) });
      }
    }
    this.emitEvent({ type: "exit", code: 0 });
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

  async sendPrompt(text: string): Promise<void> {
    this.inputQueue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? "",
    });
    this.emitEvent({ type: "status", status: "running" });
    this.wake?.();
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt();
    this.emitEvent({ type: "status", status: "idle" });
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.wake?.();
    this.abort.abort();
  }
}
