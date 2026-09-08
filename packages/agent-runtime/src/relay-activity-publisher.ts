import { randomUUID } from "node:crypto";

import type { RelayClient } from "@chief/relay-client";
import type { AgentActivityComponent } from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";

import type { AgentEvent } from "./types.js";

type ActivityPublishResult = void | Awaited<
  ReturnType<RelayClient["upsertAgentActivity"]>
>;

interface ActivityRelayClient {
  upsertAgentActivity(
    conversationId: string,
    input: Parameters<RelayClient["upsertAgentActivity"]>[1],
  ): Promise<ActivityPublishResult>;
}

interface PendingActivityPublish {
  messageId: string;
  component: AgentActivityComponent;
}

const THINKING_PUBLISH_INTERVAL_MS = 500;

function textPayload(value: unknown) {
  if (isJsonString(value)) return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable value]";
  }
}

export class RelayActivityPublisher {
  private activeThinking:
    { componentId: string; messageId: string; text: string } | undefined;
  private readonly toolMessages = new Map<
    string,
    { messageId: string; name: string; input: string }
  >();
  private readonly pendingPublishes: PendingActivityPublish[] = [];
  private drainPromise: Promise<void> | undefined;
  private readonly failures: unknown[] = [];
  private thinkingTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly client: ActivityRelayClient,
    private readonly conversationId: string,
    private readonly threadRootId?: string,
    private readonly context: {
      relayId?: string;
      workspaceId?: string;
      agentId?: string;
      cellId?: string;
      jobId?: string;
      runId?: string;
      providerSessionId?: () => string | undefined;
    } = {},
  ) {}

  accept(event: AgentEvent) {
    if (event.type === "thinkingStream") {
      this.activeThinking ??= {
        componentId: randomUUID(),
        messageId: randomUUID(),
        text: "",
      };
      this.activeThinking.text += event.text;
      this.scheduleThinking();
      return;
    }
    if (event.type !== "message") {
      if (event.type === "result" || event.type === "error") {
        this.finishThinking();
      }
      return;
    }
    for (const block of event.content) {
      if (block.type === "thinking") {
        this.activeThinking ??= {
          componentId: randomUUID(),
          messageId: randomUUID(),
          text: "",
        };
        this.activeThinking.text = block.thinking;
        this.finishThinking();
      } else if (block.type === "tool_use") {
        this.finishThinking();
        const tool = this.toolMessages.get(block.id) ?? {
          messageId: randomUUID(),
          name: block.name,
          input: textPayload(block.input),
        };
        this.toolMessages.set(block.id, tool);
        this.publish(tool.messageId, {
          id: block.id,
          kind: "tool",
          version: 1,
          payload: {
            name: tool.name,
            status: "running",
            input: tool.input,
            ...this.correlation(),
          },
        });
      } else if (block.type === "tool_result") {
        const tool = this.toolMessages.get(block.tool_use_id);
        if (!tool) continue;
        this.publish(tool.messageId, {
          id: block.tool_use_id,
          kind: "tool",
          version: 1,
          payload: {
            name: tool.name,
            status: block.is_error ? "failed" : "completed",
            input: tool.input,
            ...this.correlation(),
            ...(block.is_error
              ? { error: textPayload(block.content) }
              : { output: textPayload(block.content) }),
          },
        });
      }
    }
  }

  async flush() {
    this.finishThinking();
    while (this.drainPromise) await this.drainPromise;
    if (this.failures.length > 0) {
      throw new AggregateError(
        this.failures,
        "One or more durable activity updates could not be published.",
      );
    }
  }

  recordFailure(message = "The agent run was interrupted.") {
    this.finishThinking();
    this.publish(randomUUID(), {
      id: randomUUID(),
      kind: "error",
      version: 1,
      payload: {
        code: "agent_run_failed",
        title: "Run interrupted",
        message,
        retryable: "true",
        ...this.correlation(),
      },
    });
  }

  private scheduleThinking() {
    if (this.thinkingTimer) return;
    this.thinkingTimer = setTimeout(() => {
      this.thinkingTimer = undefined;
      this.publishThinking("working");
    }, THINKING_PUBLISH_INTERVAL_MS);
  }

  private finishThinking() {
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer);
    this.thinkingTimer = undefined;
    this.publishThinking("completed");
    this.activeThinking = undefined;
  }

  private publishThinking(status: "working" | "completed") {
    const thinking = this.activeThinking;
    if (!thinking?.text.trim()) return;
    this.publish(
      thinking.messageId,
      {
        id: thinking.componentId,
        kind: "thinking",
        version: 1,
        payload: { text: thinking.text, status, ...this.correlation() },
      },
      true,
    );
  }

  private correlation() {
    const providerSessionId = this.context.providerSessionId?.();
    return {
      ...(this.context.runId ? { runId: this.context.runId } : undefined),
      ...(this.context.jobId ? { jobId: this.context.jobId } : undefined),
      ...(providerSessionId ? { providerSessionId } : undefined),
    };
  }

  private diagnostic(
    phase: "queued" | "persisted" | "failed",
    messageId: string,
    component: AgentActivityComponent,
    error?: Parameters<typeof textPayload>[0],
  ) {
    const record = {
      scope: "cell.activity",
      phase,
      relayId: this.context.relayId,
      workspaceId: this.context.workspaceId,
      conversationId: this.conversationId,
      threadRootId: this.threadRootId,
      agentId: this.context.agentId,
      cellId: this.context.cellId,
      jobId: this.context.jobId,
      providerSessionId: this.context.providerSessionId?.(),
      runId: this.context.runId,
      toolCallId: component.kind === "tool" ? component.id : undefined,
      componentId: component.id,
      messageId,
      kind: component.kind,
      status: component.kind === "error" ? "failed" : component.payload.status,
      ...(error
        ? { error: error instanceof Error ? error.message : textPayload(error) }
        : undefined),
    };
    const serialized = JSON.stringify(record);
    if (phase === "failed") console.error("[cell-activity]", serialized);
    else console.info("[cell-activity]", serialized);
  }

  private publish(
    messageId: string,
    component: AgentActivityComponent,
    replacePending = false,
  ) {
    this.diagnostic("queued", messageId, component);
    const pendingIndex = replacePending
      ? this.pendingPublishes.findIndex(
          (candidate) => candidate.messageId === messageId,
        )
      : -1;
    if (pendingIndex >= 0) {
      this.pendingPublishes[pendingIndex] = { messageId, component };
    } else {
      this.pendingPublishes.push({ messageId, component });
    }
    this.drainPromise ??= this.drain();
  }

  private async drain() {
    try {
      while (this.pendingPublishes.length > 0) {
        const next = this.pendingPublishes.shift();
        if (!next) continue;
        try {
          await this.client.upsertAgentActivity(this.conversationId, {
            messageId: next.messageId,
            ...(this.threadRootId
              ? { threadRootId: this.threadRootId }
              : undefined),
            component: next.component,
          });
          this.diagnostic("persisted", next.messageId, next.component);
        } catch (error) {
          this.failures.push(error);
          this.diagnostic("failed", next.messageId, next.component, error);
        }
      }
    } finally {
      this.drainPromise = undefined;
      if (this.pendingPublishes.length > 0) this.drainPromise = this.drain();
    }
  }
}
