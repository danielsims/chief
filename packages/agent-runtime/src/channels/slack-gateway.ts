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

export interface SlackGatewayConfig {
  workspaceId: string;
  botToken: string;
  appToken: string;
  driver: DriverType;
  model?: string;
}

const SLACK_MESSAGE_LIMIT = 3_500;
const SPECIALIST_IDS = ["analyst", "content", "prospector", "ads"] as const;

interface SlackEnvelope {
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
      (agent) =>
        `• *${agent.name}* (\`${agent.id}\`) — ${agent.description} Address me with \`${agent.id}: …\` to route straight to them.`,
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
  private listeners = new Map<
    string,
    { session: AgentSession; listener: (event: AgentEvent) => void }
  >();

  constructor(
    private readonly manager: SessionManager,
    private readonly config: SlackGatewayConfig,
  ) {
    this.web = new WebClient(config.botToken);
  }

  async start(): Promise<void> {
    const identity = await this.web.auth.test();
    this.botUserId = identity.user_id;

    // SocketModeClient reconnects itself (autoReconnectEnabled defaults to
    // true, with backoff); we only log transitions.
    this.socket = new SocketModeClient({ appToken: this.config.appToken });
    this.socket.on("disconnected", () =>
      console.error("[slack] gateway disconnected; client will reconnect"),
    );
    const handle = (envelope: SlackEnvelope) => {
      void envelope.ack();
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
    for (const [chatId, entry] of this.listeners) {
      entry.session.off("event", entry.listener);
      await this.manager.release(chatId).catch(() => {});
    }
    this.listeners.clear();
    await this.socket?.disconnect().catch(() => {});
    this.socket = null;
  }

  private async dispatch(envelope: SlackEnvelope) {
    const event = envelope.event;
    if (!event?.channel || !event.ts) return;
    // Only human messages: skip our own posts, other bots, and edits/joins.
    if (event.bot_id || event.subtype) return;
    if (this.botUserId && event.user === this.botUserId) return;
    // message events cover DMs; app_mention covers channels. A mention in a
    // channel ALSO arrives as a message event — handle mentions only via
    // app_mention and DMs only via message to avoid double replies.
    if (event.type === "message" && event.channel_type !== "im") return;

    const raw = (event.text ?? "").trim();
    const withoutMention = this.botUserId
      ? raw.replace(new RegExp(`<@${this.botUserId}>`, "g"), "").trim()
      : raw;
    const threadTs = event.thread_ts ?? event.ts;

    if (!withoutMention || /^help$/i.test(withoutMention)) {
      await this.post(event.channel, threadTs, rosterText());
      return;
    }

    const routed = this.route(withoutMention);
    const chatId = `slack-${event.channel}-${threadTs}`;
    const session = await this.ensureSession(chatId, event.channel, threadTs);
    await session.sendPrompt(routed);
  }

  private route(text: string): string {
    const match = /^@?([a-z-]+):?\s+/i.exec(text);
    const specialist = match
      ? SPECIALIST_IDS.find((id) => id === match[1]!.toLowerCase())
      : undefined;
    if (!specialist) return text;
    const agent = getAgent(specialist);
    return `Route this to your ${agent?.name ?? specialist} specialist and answer as them:\n\n${text.slice(match![0].length)}`;
  }

  private async ensureSession(
    chatId: string,
    channel: string,
    threadTs: string,
  ): Promise<AgentSession> {
    const existing = this.listeners.get(chatId);
    if (existing) return existing.session;

    const cmo = getAgent("cmo");
    if (!cmo) throw new Error("CMO persona missing from the roster.");
    const instructions = `${composeWorkspaceInstructions(
      cmo.instructions,
      readWorkspaceContext(this.config.workspaceId),
    )}\n\nYou are replying inside Slack; keep replies concise, use Slack formatting (no markdown headers), and never emit CHIEF_* protocol lines.`;

    const session = await this.manager.ensure(
      { ...cmo, instructions },
      chatId,
      {
        driver: this.config.driver,
        access: "full",
        workspaceId: this.config.workspaceId,
        model: this.config.model,
        mcpServers: [
          executorToolServer(
            existingExecutorWorkspace(this.config.workspaceId),
          ),
        ],
      },
    );
    this.manager.retain(chatId);

    const listener = (event: AgentEvent) => {
      if (event.type === "error") {
        void this.post(
          channel,
          threadTs,
          `Something went wrong: ${event.message}`,
        );
        return;
      }
      if (event.type !== "result") return;
      const text = lastAssistantText(session.events);
      if (text) void this.post(channel, threadTs, text);
    };
    session.on("event", listener);
    this.listeners.set(chatId, { session, listener });
    return session;
  }

  private async post(channel: string, threadTs: string, text: string) {
    for (const chunk of chunkText(text)) {
      await this.web.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: chunk,
      });
    }
  }
}
