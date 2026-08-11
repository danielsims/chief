import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";

import type { SessionManager } from "../manager.js";
import type { AgentSession } from "../session.js";
import type { AgentEvent, DriverType } from "../types.js";
import {
  composeWorkspaceInstructions,
  defaultAgents,
  getAgent,
} from "../agents/index.js";
import { existingExecutorWorkspace } from "../tools/control-plane.js";
import { executorToolServer } from "../tools/spec.js";
import { readWorkspaceContext } from "../workspace-context.js";
import { workspaceKey } from "../workspace-secrets.js";
import { REMOTE_CHANNEL_ACCESS } from "./access.js";

export interface SlackGatewayConfig {
  workspaceId: string;
  botToken: string;
  appToken: string;
  driver: Exclude<DriverType, "remote">;
  model?: string;
  allowedUserIds: string[];
  allowedChannelIds: string[];
}

const SLACK_MESSAGE_LIMIT = 3_500;
const SPECIALIST_IDS = ["analyst", "content", "prospector", "ads"] as const;

export function slackConversationId(input: {
  workspaceId: string;
  teamId: string;
  channelId: string;
  messageTs: string;
  threadTs?: string;
  direct: boolean;
}) {
  const conversationKey = input.direct
    ? `dm-${input.channelId}`
    : `channel-${input.channelId}-thread-${input.threadTs ?? input.messageTs}`;
  return `slack-${workspaceKey(input.workspaceId)}-${input.teamId}-${conversationKey}`;
}

export function slackSourceAllowed(
  userId: string | undefined,
  channelId: string,
  allowedUserIds: readonly string[],
  allowedChannelIds: readonly string[],
) {
  return (
    Boolean(userId && allowedUserIds.includes(userId)) ||
    allowedChannelIds.includes(channelId)
  );
}

interface SlackEnvelope {
  envelope_id?: string;
  team_id?: string;
  ack: (response?: unknown) => Promise<void>;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    channel_type?: string;
  };
}

function lastAssistantText(events: readonly AgentEvent[]): string | undefined {
  return events
    .flatMap((event) =>
      event.type === "message" && event.role === "assistant"
        ? event.content.flatMap((block) =>
            block.type === "text" ? [block.text] : [],
          )
        : [],
    )
    .at(-1);
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > SLACK_MESSAGE_LIMIT) {
    const window = rest.slice(0, SLACK_MESSAGE_LIMIT);
    const breakAt = window.lastIndexOf("\n");
    const cut =
      breakAt > SLACK_MESSAGE_LIMIT / 2 ? breakAt : SLACK_MESSAGE_LIMIT;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function rosterText(): string {
  return defaultAgents
    .filter((agent) => agent.id !== "setup")
    .map(
      (agent) => `• *${agent.name}* (\`${agent.id}\`) — ${agent.description}`,
    )
    .join("\n");
}

/**
 * Local Slack surface: an outbound Socket Mode connection (no public URL)
 * that routes DMs and mentions into CLI-driver sessions on this machine —
 * the agents answer from Slack while running on the user's own
 * subscriptions. Placement rule: a workspace enables either this local
 * gateway or the deployed Slack channel, never both.
 */
export class SlackGateway {
  private socket: SocketModeClient | null = null;
  private web: WebClient;
  private botUserId: string | undefined;
  private teamId: string | undefined;
  private listeners = new Map<string, AgentSession>();
  private delivered = new Set<string>();

  constructor(
    private readonly manager: SessionManager,
    private readonly config: SlackGatewayConfig,
  ) {
    this.web = new WebClient(config.botToken);
  }

  async start(): Promise<void> {
    const identity = await this.web.auth.test();
    this.botUserId = identity.user_id;
    this.teamId = identity.team_id;

    // SocketModeClient reconnects itself (autoReconnectEnabled defaults to
    // true, with backoff); we only log transitions.
    this.socket = new SocketModeClient({ appToken: this.config.appToken });
    this.socket.on("disconnected", () =>
      console.error("[slack] gateway disconnected; client will reconnect"),
    );
    const handle = (envelope: SlackEnvelope) => {
      void envelope.ack();
      if (envelope.envelope_id && this.delivered.has(envelope.envelope_id))
        return;
      if (envelope.envelope_id) {
        this.delivered.add(envelope.envelope_id);
        if (this.delivered.size > 1_000) {
          const oldest = this.delivered.values().next().value;
          if (oldest) this.delivered.delete(oldest);
        }
      }
      void this.dispatch(envelope).catch((error) =>
        console.error("[slack] event failed:", error),
      );
    };
    this.socket.on("message", handle);
    this.socket.on("app_mention", handle);
    await this.socket.start();
    console.log(
      `[slack] gateway connected for workspace ${this.config.workspaceId}`,
    );
  }

  async stop(): Promise<void> {
    for (const [chatId] of this.listeners) {
      await this.manager
        .release(this.config.workspaceId, chatId)
        .catch(() => {});
    }
    this.listeners.clear();
    await this.socket?.disconnect().catch(() => {});
    this.socket = null;
  }

  private async dispatch(envelope: SlackEnvelope) {
    const event = envelope.event;
    if (!event?.channel || !event.ts) return;
    const channel = event.channel;
    if (envelope.team_id && this.teamId && envelope.team_id !== this.teamId)
      return;
    // Only human messages: skip our own posts, other bots, and edits/joins.
    if (event.bot_id || event.subtype) return;
    if (this.botUserId && event.user === this.botUserId) return;
    // message events cover DMs; app_mention covers channels. A mention in a
    // channel ALSO arrives as a message event — handle mentions only via
    // app_mention and DMs only via message to avoid double replies.
    if (event.type === "message" && event.channel_type !== "im") return;
    if (
      !slackSourceAllowed(
        event.user,
        channel,
        this.config.allowedUserIds,
        this.config.allowedChannelIds,
      )
    ) {
      return;
    }

    const raw = (event.text ?? "").trim();
    const withoutMention = this.botUserId
      ? raw.replace(new RegExp(`<@${this.botUserId}>`, "g"), "").trim()
      : raw;
    const threadTs = event.thread_ts ?? event.ts;

    if (!withoutMention || /^help$/i.test(withoutMention)) {
      await this.post(channel, threadTs, rosterText());
      return;
    }

    const routed = this.route(withoutMention);
    const chatId = slackConversationId({
      workspaceId: this.config.workspaceId,
      teamId: this.teamId ?? "team",
      channelId: channel,
      messageTs: event.ts,
      threadTs: event.thread_ts,
      direct: event.channel_type === "im",
    });
    const session = await this.ensureSession(chatId);
    const releaseExecution = this.manager.acquireExecution(
      this.config.workspaceId,
      chatId,
      "channel",
    );
    const turnStart = session.events.length;
    const releaseOnTerminal = (agentEvent: AgentEvent) => {
      if (agentEvent.type === "permission") {
        session.respondPermission(agentEvent.requestId, "deny");
        void this.post(
          channel,
          threadTs,
          "This action needs approval in the Chief desktop app.",
        );
        return;
      }
      if (
        agentEvent.type === "result" ||
        agentEvent.type === "error" ||
        agentEvent.type === "exit"
      ) {
        session.off("event", releaseOnTerminal);
        releaseExecution();
        if (agentEvent.type === "error") {
          void this.post(
            channel,
            threadTs,
            `Something went wrong: ${agentEvent.message}`,
          );
        } else if (agentEvent.type === "result") {
          const text = lastAssistantText(session.events.slice(turnStart));
          if (text) void this.post(channel, threadTs, text);
        }
      }
    };
    session.on("event", releaseOnTerminal);
    try {
      await session.sendPrompt(routed);
    } catch (error) {
      session.off("event", releaseOnTerminal);
      releaseExecution();
      throw error;
    }
  }

  private route(text: string): string {
    const match = /^@?([a-z-]+):?\s+/i.exec(text);
    const requested = match?.[1]?.toLowerCase();
    const specialist = requested
      ? SPECIALIST_IDS.find((id) => id === requested)
      : undefined;
    if (!specialist) return text;
    const agent = getAgent(specialist);
    return `Route this to your ${agent?.name ?? specialist} specialist and answer as them:\n\n${text.slice(match?.[0].length ?? 0)}`;
  }

  private async ensureSession(chatId: string): Promise<AgentSession> {
    const existing = this.listeners.get(chatId);
    if (existing) return existing;

    const cmo = getAgent("chief");
    if (!cmo) throw new Error("Chief is missing from the agent roster.");
    const instructions = `${composeWorkspaceInstructions(
      cmo.instructions,
      readWorkspaceContext(this.config.workspaceId),
    )}\n\nYou are replying inside Slack; keep replies concise, use Slack formatting (no markdown headers), and never emit CHIEF_* protocol lines.`;

    const session = await this.manager.ensureRootChat(
      { ...cmo, instructions },
      chatId,
      {
        driver: this.config.driver,
        access: REMOTE_CHANNEL_ACCESS,
        workspaceId: this.config.workspaceId,
        model: this.config.model,
        executionOwner: "channel",
        secretAccess: false,
        mcpServers: [
          executorToolServer(
            existingExecutorWorkspace(this.config.workspaceId),
          ),
        ],
      },
      "Chief via Slack",
    );
    this.manager.retain(this.config.workspaceId, chatId);

    this.listeners.set(chatId, session);
    return session;
  }

  private async post(channel: string, threadTs: string, text: string) {
    const safeText = text
      .split("\n")
      .filter((line) => !/^CHIEF_[A-Z_]+\s/.test(line.trim()))
      .join("\n")
      .trim();
    for (const chunk of chunkText(safeText)) {
      await this.web.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: chunk,
      });
    }
  }
}
