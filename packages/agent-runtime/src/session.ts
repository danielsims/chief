import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BaseDriver } from "./drivers/base.js";
import type {
  AccessMode,
  AgentDefinition,
  AgentEvent,
  AutomationGrant,
  ChiefMessageMetadata,
  DriverType,
  McpServerSpec,
  MessageAttachment,
} from "./types.js";
import { createDriver } from "./drivers/index.js";
import { remoteHistoryContext } from "./drivers/remote-history.js";
import { withGenerativeDataParts } from "./generative-ui.js";

/** Runtime-owned execution configuration for one chat. */
export interface SessionConfig {
  driver: DriverType;
  access: AccessMode;
  workspaceId: string;
  env?: Record<string, string>;
  model?: string;
  mcpServers?: McpServerSpec[];
  automationGrant?: AutomationGrant;
  executionOwner?: "interactive" | "schedule" | "channel" | "delegation";
  /** Dynamic identifiers that remote deployments do not compile into their prompt. */
  runtimeContext?: string;
  /** Private specialist sessions never receive workspace credentials. */
  secretAccess?: boolean;
}

export class AgentSession extends EventEmitter {
  readonly agent: AgentDefinition;
  readonly chatId: string;
  readonly config: SessionConfig;
  /** Backend-native session/thread id, used for resume. */
  sessionId: string | undefined;
  driverState: unknown;
  events: AgentEvent[] = [];
  private driver: BaseDriver;
  private status: "idle" | "running" | "waiting" | "error" = "idle";
  private promptBootstrap: string | undefined;
  private workingDirectory: string | undefined;
  private stallTimer: NodeJS.Timeout | null = null;
  private readonly stallTimeoutMs = 6 * 60_000;
  private activeReplyContext:
    | {
        threadRootId?: string;
        explicitThreadRootId?: string;
        mentions?: string[];
      }
    | undefined;

  constructor(
    agent: AgentDefinition,
    chatId: string,
    config: SessionConfig,
    initialEvents: AgentEvent[] = [],
  ) {
    super();
    this.agent = agent;
    this.chatId = chatId;
    this.config = config;
    this.driver = createDriver(config.driver);

    this.events = initialEvents.map(withGenerativeDataParts).slice(-500);
    this.driver.on("event", (rawEvent: AgentEvent) => {
      const contextualEvent =
        rawEvent.type === "message" && rawEvent.role === "assistant"
          ? {
              ...rawEvent,
              id: rawEvent.id ?? randomUUID(),
              threadRootId: this.activeReplyContext?.threadRootId,
              mentions: this.activeReplyContext?.mentions,
            }
          : rawEvent;
      const event = withGenerativeDataParts(contextualEvent);
      if (event.type === "init") this.sessionId = event.sessionId;
      if (event.type === "status") this.status = event.status;
      if (
        event.type === "result" ||
        event.type === "error" ||
        event.type === "exit"
      ) {
        this.status = event.type === "error" ? "error" : "idle";
        // Some providers report completion before emitting their final
        // assistant message. Keep the turn owner after a successful result so
        // that late content remains attached to the channel thread that
        // started it; the next user prompt replaces this context atomically.
        if (event.type !== "result") this.activeReplyContext = undefined;
      }
      this.record(event);
      if (this.status === "running") this.armStallWatchdog();
      else this.clearStallWatchdog();
    });
    this.driver.on("state", (state: unknown) => {
      this.driverState = state;
      this.emit("state", state);
    });
  }

  get isBusy() {
    const driverInFlight =
      this.driverState !== null &&
      typeof this.driverState === "object" &&
      "inFlight" in this.driverState &&
      this.driverState.inFlight === true;
    return (
      this.status === "running" || this.status === "waiting" || driverInFlight
    );
  }

  /** The explicit channel thread that owns host UI opened by this turn. */
  get activeThreadRootId() {
    return this.activeReplyContext?.explicitThreadRootId;
  }

  private record(event: AgentEvent) {
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    this.emit("event", event);
  }

  private clearStallWatchdog() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  }

  private armStallWatchdog() {
    this.clearStallWatchdog();
    this.stallTimer = setTimeout(() => {
      if (!this.isBusy) return;
      void this.driver.interrupt().catch(() => {});
      this.status = "idle";
      this.record({
        type: "error",
        message:
          "The agent stopped after six minutes without any new output. You can retry the request.",
      });
      this.record({ type: "status", status: "idle" });
    }, this.stallTimeoutMs);
    this.stallTimer.unref();
  }

  async start(cwd: string, resumeSessionId?: string, resumeState?: unknown) {
    this.workingDirectory = cwd;
    if (!resumeSessionId && this.config.driver !== "remote") {
      this.promptBootstrap = remoteHistoryContext(this.events);
    }
    await this.driver.start({
      cwd,
      storageKey: `${this.config.workspaceId}\0${this.chatId}`,
      instructions: this.agent.instructions,
      runtimeContext: this.config.runtimeContext,
      access: this.config.access,
      env: this.config.env,
      model: this.config.model,
      resumeSessionId,
      resumeState,
      history: this.events,
      mcpServers: this.config.mcpServers,
      automationGrant: this.config.automationGrant,
    });
  }

  async sendPrompt(
    text: string,
    messageId?: string,
    record = true,
    context?: {
      threadRootId?: string;
      mentions?: string[];
      attachments?: MessageAttachment[];
    },
  ) {
    const threadContext = context?.threadRootId
      ? await this.threadPromptContext(context.threadRootId)
      : undefined;
    const attachmentContext = await this.attachmentPromptContext(
      context?.attachments,
    );
    // Record the user turn as an event so reconnecting clients can rebuild
    // the full transcript from the buffer.
    const event: AgentEvent = {
      type: "message",
      id: messageId,
      role: "user",
      content: [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...(context?.attachments ?? []).map((attachment) => ({
          type: "image" as const,
          ...attachment,
        })),
      ],
      threadRootId: context?.threadRootId,
      mentions: context?.mentions,
    };
    if (record) {
      this.events.push(event);
      this.emit("event", event);
    }
    this.status = "running";
    this.activeReplyContext = {
      threadRootId: context?.threadRootId,
      explicitThreadRootId: context?.threadRootId,
      mentions: context?.mentions,
    };
    this.armStallWatchdog();
    const bootstrap = record ? this.promptBootstrap : undefined;
    this.promptBootstrap = undefined;
    try {
      const addressedText = context?.mentions?.length
        ? `[Channel recipient routing: this message is addressed to these agent identities: ${context.mentions.join(", ")}. The user may have mentioned them in this message or continued an already-addressed thread. Reply directly as your configured persona.]\n\n${text}`
        : text;
      const routedText = [threadContext, addressedText, attachmentContext]
        .filter(Boolean)
        .join("\n\n");
      await this.driver.sendPrompt(
        bootstrap
          ? `${bootstrap}\n\nContinue the conversation with this new user message:\n\n${routedText}`
          : routedText,
      );
    } catch (error) {
      this.status = "idle";
      this.clearStallWatchdog();
      throw error;
    }
  }

  private async attachmentPromptContext(
    attachments: readonly MessageAttachment[] | undefined,
  ) {
    if (!attachments?.length || !this.workingDirectory) return undefined;
    const directory = join(this.workingDirectory, ".message-attachments");
    await mkdir(directory, { recursive: true });
    const paths = await Promise.all(
      attachments.map(async (attachment) => {
        const extension =
          attachment.mediaType === "image/png"
            ? "png"
            : attachment.mediaType === "image/webp"
              ? "webp"
              : attachment.mediaType === "image/gif"
                ? "gif"
                : "jpg";
        const content = attachment.url.slice(attachment.url.indexOf(",") + 1);
        const digest = createHash("sha256")
          .update(content)
          .digest("hex")
          .slice(0, 20);
        const path = join(directory, `${digest}.${extension}`);
        await writeFile(path, Buffer.from(content, "base64"));
        return `${attachment.name}: ${path}`;
      }),
    );
    return `[Attached images — inspect these files with your image-reading tools before answering:\n${paths.map((path) => `- ${path}`).join("\n")}]`;
  }

  private async threadPromptContext(threadRootId: string) {
    const allMessages = this.events.filter(
      (event): event is Extract<AgentEvent, { type: "message" }> =>
        event.type === "message",
    );
    const rootIndex = allMessages.findIndex(
      (message) => message.id === threadRootId,
    );
    const recentChannelMessages =
      rootIndex > 0
        ? allMessages
            .slice(0, rootIndex)
            .filter((message) => !message.threadRootId)
            .slice(-8)
        : [];
    const threadMessages = allMessages
      .filter(
        (message) =>
          message.id === threadRootId || message.threadRootId === threadRootId,
      )
      .slice(-20);
    if (threadMessages.length === 0) return undefined;

    const formatMessages = async (
      messages: readonly Extract<AgentEvent, { type: "message" }>[],
    ) => {
      const lines: string[] = [];
      for (const message of messages) {
        const text = message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n")
          .trim();
        const attachments = message.content.flatMap((block) =>
          block.type === "image"
            ? [
                {
                  name: block.name,
                  mediaType: block.mediaType,
                  url: block.url,
                },
              ]
            : [],
        );
        const imageContext = await this.attachmentPromptContext(attachments);
        const content = [text, imageContext].filter(Boolean).join("\n");
        if (content) {
          lines.push(
            `${message.role === "user" ? "User" : "Agent"}: ${content}`,
          );
        }
      }
      return lines;
    };

    const [channelLines, threadLines] = await Promise.all([
      formatMessages(recentChannelMessages),
      formatMessages(threadMessages),
    ]);
    return [
      channelLines.length
        ? `[Recent shared channel context before this thread:\n${channelLines.join("\n\n")}]`
        : undefined,
      threadLines.length
        ? `[Current channel thread context:\n${threadLines.join("\n\n")}]`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  recordUserMessage(
    text: string,
    id?: string,
    context?: {
      threadRootId?: string;
      mentions?: string[];
      attachments?: MessageAttachment[];
      channelAction?: ChiefMessageMetadata["channelAction"];
    },
  ) {
    this.record({
      type: "message",
      id,
      role: "user",
      content: [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...(context?.attachments ?? []).map((attachment) => ({
          type: "image" as const,
          ...attachment,
        })),
      ],
      threadRootId: context?.threadRootId,
      mentions: context?.mentions,
      channelAction: context?.channelAction,
    });
  }

  recordAssistantMessage(text: string) {
    this.record({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
    });
  }

  respondPermission(requestId: string, behavior: "allow" | "deny") {
    this.driver.respondPermission(requestId, behavior);
    // Record the resolution in the buffer so replayed transcripts don't
    // resurrect an approval prompt that was already answered.
    const event: AgentEvent = {
      type: "permissionResolved",
      requestId,
      behavior,
    };
    this.events.push(event);
    this.emit("event", event);
  }

  respondQuestion(requestId: string, answers: Record<string, string> | null) {
    // The driver emits questionResolved itself, so the buffer stays correct.
    this.driver.respondQuestion(requestId, answers);
  }

  interrupt() {
    return this.driver.interrupt();
  }

  async stop() {
    this.clearStallWatchdog();
    await this.driver.stop();
    this.removeAllListeners();
  }
}
