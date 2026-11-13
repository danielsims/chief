import type {
  AgentPrincipal,
  ConversationEvent,
  ConversationMessage,
  OwnedAgentMessage,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  agentIdSchema,
  appendMessageCommandSchema,
  appendMessageResultSchema,
  conversationEventSchema,
  hexPubkeySchema,
  ownedAgentMessagePageSchema,
  ownedAgentPostCommandSchema,
  ownedAgentPostResultSchema,
  ownedAgentSocketTicketSchema,
  userIdSchema,
} from "@chief/relay-contracts";

import type { OwnedAgentService } from "./owned-agent-service";
import type { LiveEventRow } from "./owned-agent-shared";
import type { OwnedAgentRow } from "./queries/owned-agents/agents";
import type { ChannelRow } from "./workspace-channel-store";
import { HttpError, parseJson } from "./http";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { wakeOwnedAgentListeners } from "./owned-agent-listeners";
import {
  channelSummary,
  clampInteger,
  foldMessages,
  lookaheadEvents,
  maximumPostsPerWindow,
  postWindowMs,
} from "./owned-agent-shared";
import {
  ownedAgentChannelsListForConversation,
  ownedAgentsFind,
  ownedAgentsUpdate,
  ownedAgentThreadsHas,
  ownedAgentThreadsInsert,
} from "./queries/owned-agents/agents";
import { listConversationEvents } from "./queries/workspace-live-events/list-conversation-events";
import { listRecentConversationEvents } from "./queries/workspace-live-events/list-recent-conversation-events";
import { workspaceAgentNames } from "./workspace-agent-runtime";
import { WorkspaceLiveStore } from "./workspace-live-store";
import { memberDisplayNames } from "./workspace-member-names";

export function readMessages(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  input: { after: string | null; limit: string | null; channel: string | null },
) {
  const limit = clampInteger(input.limit, 30, 1, 100);
  const accessible = this.accessibleChannels(agent);
  const selected = input.channel
    ? [this.requireAgentChannel(agent, input.channel)]
    : accessible;
  const conversationIds = selected.map((channel) => channel.conversation_id);
  const current = new WorkspaceLiveStore(this.storage).currentSequence();
  let events: ConversationEvent[];
  let cursor: number;
  if (input.after === null) {
    // No cursor: the newest messages, and where to continue from.
    events = this.decode(
      listRecentConversationEvents<LiveEventRow>(this.storage, {
        conversationIds,
        limit: limit * 4,
      }).reverse(),
    );
    cursor = current;
  } else {
    const after = clampInteger(input.after, 0, 0);
    const rows = listConversationEvents<LiveEventRow>(this.storage, {
      after,
      conversationIds,
      limit: limit + lookaheadEvents,
    });
    const page = rows.slice(0, limit);
    events = this.decode(rows);
    const last = page.at(-1)?.sequence;
    // Later edits and deletions still apply, but only this page is returned.
    cursor =
      rows.length > limit && last !== undefined
        ? last
        : Math.max(current, after);
    const through = cursor;
    events = events.filter(
      (event) =>
        event.type !== "conversation.message.appended" ||
        event.sequence <= through,
    );
  }
  const folded = foldMessages(events);
  const messages = (input.after === null ? folded.slice(-limit) : folded).map(
    (entry) => this.project(agent, entry, selected),
  );
  return ownedAgentMessagePageSchema.parse({
    messages,
    cursor,
    channels: accessible.map(channelSummary),
  });
}

export function decode(this: OwnedAgentService, rows: readonly LiveEventRow[]) {
  return rows.flatMap((row) => {
    const parsed = conversationEventSchema.safeParse(
      JSON.parse(row.event_json),
    );
    return parsed.success ? [parsed.data] : [];
  });
}

export function project(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  entry: { message: ConversationMessage; cursor: number },
  channels: readonly ChannelRow[],
): OwnedAgentMessage {
  const { message } = entry;
  const channel = channels.find(
    (candidate) => candidate.conversation_id === message.conversationId,
  );
  return {
    id: message.id,
    channel: {
      id: message.conversationId,
      name: channel?.name ?? "",
    },
    threadRootId: message.threadRootId ?? null,
    author: this.authorOf(agent, message),
    body: message.body,
    createdAt: message.createdAt,
    cursor: entry.cursor,
    wakeReason: this.wakeReason(agent, message),
  };
}

export function authorOf(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  message: ConversationMessage,
): OwnedAgentMessage["author"] {
  if (message.author.kind === "user") {
    return {
      kind: "person",
      name:
        memberDisplayNames(this.storage).get(`user:${message.author.id}`) ??
        "Member",
      you: false,
    };
  }
  if (message.author.kind === "agent") {
    return {
      kind: "agent",
      name:
        workspaceAgentNames(this.storage).get(message.author.id) ??
        ownedAgentsFind(this.storage, message.author.id)?.name ??
        "Agent",
      you: message.author.id === agent.agent_id,
    };
  }
  return { kind: "system", name: "Chief", you: false };
}

export function wakeReason(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  message: ConversationMessage,
) {
  if (message.author.kind === "agent" && message.author.id === agent.agent_id) {
    return null;
  }
  if (message.mentions.some((id) => id === agent.agent_id)) {
    return "mention" as const;
  }
  if (
    message.author.kind === "user" &&
    message.threadRootId &&
    ownedAgentThreadsHas(this.storage, agent.agent_id, message.threadRootId)
  ) {
    return "thread" as const;
  }
  return null;
}

export function wake(this: OwnedAgentService, event: ConversationEvent) {
  if (event.type !== "conversation.message.appended") return;
  const message = event.payload.message;
  if (message.deleted || message.body.trim() === "") return;
  const members = ownedAgentChannelsListForConversation(
    this.storage,
    message.conversationId,
  );
  if (members.length === 0) return;
  let channel: ChannelRow;
  try {
    channel = this.channels.requireChannel(message.conversationId);
  } catch {
    return;
  }
  for (const member of members) {
    const agent = ownedAgentsFind(this.storage, member.agent_id);
    if (
      agent?.status !== "active" ||
      !this.channels.agentMayAccess(channel, agent.owner_user_id) ||
      this.wakeReason(agent, message) === null
    ) {
      continue;
    }
    wakeOwnedAgentListeners(this.storage, agent.agent_id, event.sequence);
  }
}

export function principalFor(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  workspaceId: WorkspaceId,
): AgentPrincipal {
  return {
    kind: "agent",
    agentId: agentIdSchema.parse(agent.agent_id),
    pubkey: hexPubkeySchema.parse(agent.pubkey),
    workspaceId,
    role: "member",
    ownerUserId: userIdSchema.parse(agent.owner_user_id),
  };
}

export function conversation(
  this: OwnedAgentService,
  workspaceId: WorkspaceId,
  conversationId: string,
) {
  return this.env.CONVERSATIONS.get(
    this.env.CONVERSATIONS.idFromName(`${workspaceId}:${conversationId}`),
  );
}

export async function post(
  this: OwnedAgentService,
  request: Request,
  agent: OwnedAgentRow,
  workspaceId: WorkspaceId,
) {
  const input = ownedAgentPostCommandSchema.parse(await parseJson(request));
  this.requireAgentChannel(agent, input.channelId);
  this.consumePostAllowance(agent);
  const principal = this.principalFor(agent, workspaceId);
  const context = {
    principal,
    requestId: crypto.randomUUID(),
    workspaceId,
    conversationId: input.channelId,
  };
  const conversation = this.conversation(workspaceId, input.channelId);
  if (input.threadRootId) {
    // The thread must already exist in this channel.
    const root = await conversation.fetch(
      withTrustedContext(
        new Request(
          `https://conversation.internal/messages/${encodeURIComponent(input.threadRootId)}`,
        ),
        context,
      ),
    );
    const found = root.ok;
    await releaseInternalResponse(root);
    if (!found) {
      throw new HttpError(
        404,
        "thread_not_found",
        "That thread was not found in this channel.",
      );
    }
  }
  const messageId = input.idempotencyKey ?? crypto.randomUUID();
  const command = appendMessageCommandSchema.parse({
    commandId: messageId,
    protocolVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      messageId,
      conversationId: input.channelId,
      threadRootId: input.threadRootId,
      body: input.body,
      mentions: [],
      components: [],
    },
  });
  const response = await conversation.fetch(
    withTrustedContext(
      new Request(
        `https://relay.internal/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(input.channelId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        },
      ),
      context,
    ),
  );
  if (!response.ok) {
    await releaseInternalResponse(response);
    throw new HttpError(502, "agent_post_failed", "The message was not sent.");
  }
  const result = appendMessageResultSchema.parse(await response.json());
  // A reused idempotency key must never surface someone else's message.
  if (
    result.message.author.kind !== "agent" ||
    result.message.author.id !== agent.agent_id
  ) {
    throw new HttpError(
      409,
      "idempotency_key_conflict",
      "That idempotency key was already used.",
    );
  }
  ownedAgentThreadsInsert(
    this.storage,
    agent.agent_id,
    result.message.threadRootId ?? result.message.id,
  );
  return ownedAgentPostResultSchema.parse({
    id: result.message.id,
    channelId: input.channelId,
    threadRootId: result.message.threadRootId ?? null,
    cursor: result.message.sequence,
  });
}

export function consumePostAllowance(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
) {
  const now = Date.now();
  const started = agent.post_window_started_at
    ? Date.parse(agent.post_window_started_at)
    : 0;
  const fresh = now - started > postWindowMs;
  const count = fresh ? 0 : agent.post_window_count;
  if (count >= maximumPostsPerWindow) {
    throw new HttpError(
      429,
      "agent_rate_limited",
      "Too many messages. Wait a few minutes before posting again.",
    );
  }
  ownedAgentsUpdate(this.storage, agent.agent_id, {
    post_window_started_at: fresh
      ? new Date(now).toISOString()
      : agent.post_window_started_at,
    post_window_count: count + 1,
  });
}

export async function socketTicket(
  this: OwnedAgentService,
  agent: OwnedAgentRow,
  workspaceId: WorkspaceId,
  origin: string,
) {
  const { ticket, expiresAt } = await new WorkspaceLiveStore(
    this.storage,
  ).createSocketTicket(this.principalFor(agent, workspaceId));
  const url = new URL("/v1/connect", origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("ticket", ticket);
  return ownedAgentSocketTicketSchema.parse({
    url: url.toString(),
    expiresAt,
  });
}
