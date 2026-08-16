import type { ChannelLocalToolContext } from "./channel-local-tools.js";
import type { WorkspaceChannel } from "./channel-types.js";
import { normalizeAgentText } from "./agent-output.js";
import {
  ChannelApiFailure,
  fail,
  optionalText,
  textValue,
  validatedAgentIds,
} from "./channel-local-tool-input.js";
import { emitMemberAddedEvent } from "./channel-membership-local-tools.js";
import { normalizedChannelMentions } from "./channel-message-mentions.js";
import { ensureChannelPermission } from "./channel-permissions.js";
import { postPluginRecommendation } from "./channel-plugin-recommendation.js";
import {
  actorOwnsMessage,
  channelMessages,
  channelTimeline,
  cursorPage,
  messageById,
  resolveChannelMessageId,
  threadMessages,
} from "./channels/message-projection.js";
import {
  createChannelDeletion,
  createChannelEvent,
  createChannelMessageEdit,
  createChannelReaction,
} from "./channels/nip29.js";

interface MessageToolResult {
  handled: boolean;
  value?: unknown;
  status?: number;
}

const THREAD_PREVIEW_LIMIT = 3;
const THREAD_PREVIEW_LENGTH = 600;

function compactMessage(message: NonNullable<ReturnType<typeof messageById>>) {
  return {
    id: message.id,
    content: message.content.slice(0, THREAD_PREVIEW_LENGTH),
    actor: message.actor,
    createdAt: message.createdAt,
    threadRootId: message.threadRootId,
  };
}

function withThreadContext(
  events: Parameters<typeof channelTimeline>[0],
  message: NonNullable<ReturnType<typeof messageById>>,
  viewer: ChannelLocalToolContext["actor"],
) {
  if (message.threadRootId) {
    const root = messageById(events, message.threadRootId, viewer);
    return {
      ...message,
      threadRoot: root ? compactMessage(root) : undefined,
    };
  }
  const replies = threadMessages(events, message.id, viewer).filter(
    (candidate) => candidate.id !== message.id,
  );
  return {
    ...message,
    recentReplies: replies.slice(-THREAD_PREVIEW_LIMIT).map(compactMessage),
  };
}

function timelineWithThreadContext(
  events: Parameters<typeof channelTimeline>[0],
  viewer: ChannelLocalToolContext["actor"],
) {
  return channelTimeline(events, viewer).map((message) =>
    withThreadContext(events, message, viewer),
  );
}

function numberQuery(url: URL, name: string, fallback: number) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function ensureChannelMember(
  channel: WorkspaceChannel,
  context: ChannelLocalToolContext,
) {
  if (
    context.actor.type === "agent" &&
    !channel.agentIds.includes(context.actor.id)
  ) {
    fail(
      `Join #${channel.name} before reading or posting.`,
      403,
      "not_a_channel_member",
    );
  }
}

async function append(
  context: ChannelLocalToolContext,
  workspaceId: string,
  event: Parameters<ChannelLocalToolContext["channelStore"]["appendEvent"]>[1],
) {
  await context.channelStore.appendEvent(workspaceId, event);
  await context.onChannelEvent?.(event);
  return event;
}

async function searchMessages(
  url: URL,
  workspaceId: string,
  context: ChannelLocalToolContext,
): Promise<MessageToolResult> {
  const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
  if (query.length < 2) {
    fail("query must contain at least two characters.", 400, "invalid_query");
  }
  const channelFilter = url.searchParams.get("channelId");
  const authorFilter = url.searchParams.get("authorId");
  const after = numberQuery(url, "after", 0);
  const before = numberQuery(url, "before", Number.POSITIVE_INFINITY);
  const channels = (await context.channelStore.list(workspaceId)).filter(
    (channel) =>
      channel.visibility !== "direct" &&
      (!channelFilter ||
        channel.id === channelFilter ||
        channel.slug === channelFilter) &&
      (context.actor.type !== "agent" ||
        channel.visibility === "public" ||
        channel.agentIds.includes(context.actor.id)),
  );
  const matches = [];
  for (const channel of channels) {
    const events = await context.channelStore.events(workspaceId, channel.id);
    for (const message of channelMessages(events, context.actor)) {
      if (
        !message.deleted &&
        message.createdAt >= after &&
        message.createdAt <= before &&
        (!authorFilter || message.actor.id === authorFilter) &&
        message.content.toLowerCase().includes(query)
      ) {
        matches.push({
          ...withThreadContext(events, message, context.actor),
          channel: { id: channel.id, name: channel.name, slug: channel.slug },
        });
      }
    }
  }
  const page = cursorPage(matches, {
    cursor: url.searchParams.get("cursor"),
    limit: numberQuery(url, "limit", 50),
  });
  return {
    handled: true,
    value: { messages: page.items, nextCursor: page.nextCursor },
  };
}

export async function handleChannelMessageLocalTool(input: {
  request: Request;
  workspaceId: string;
  body: Record<string, unknown>;
  context: ChannelLocalToolContext;
  channel?: WorkspaceChannel;
  tail?: string;
}): Promise<MessageToolResult> {
  const { request, workspaceId, body, context, channel, tail = "" } = input;
  const url = new URL(request.url);
  try {
    if (
      url.pathname === "/local-tools/messages/search" &&
      request.method === "GET"
    ) {
      return await searchMessages(url, workspaceId, context);
    }
    if (!channel) return { handled: false };
    ensureChannelMember(channel, context);
    const events = await context.channelStore.events(workspaceId, channel.id);

    if (tail === "plugins/recommend" && request.method === "POST") {
      if (channel.lifecycle === "archived") {
        fail("Restore this channel before posting.", 409, "channel_archived");
      }
      return {
        handled: true,
        value: await postPluginRecommendation({
          workspaceId,
          channel,
          events,
          body,
          context,
        }),
      };
    }

    if (tail === "messages" && request.method === "GET") {
      const page = cursorPage(
        timelineWithThreadContext(events, context.actor),
        {
          cursor: url.searchParams.get("cursor"),
          limit: numberQuery(url, "limit", 50),
        },
      );
      return {
        handled: true,
        value: { messages: page.items, nextCursor: page.nextCursor },
      };
    }
    if (tail === "messages" && request.method === "POST") {
      if (channel.lifecycle === "archived") {
        fail("Restore this channel before posting.", 409, "channel_archived");
      }
      const rawContent = textValue(body.content, "content", 8_000);
      const content =
        context.actor.type === "agent"
          ? normalizeAgentText(rawContent)
          : rawContent;
      const idempotencyKey = optionalText(
        body.idempotencyKey,
        "idempotencyKey",
        120,
      );
      const sourceId = idempotencyKey
        ? `channel-api:${idempotencyKey}`
        : undefined;
      const requestedThreadRootId = optionalText(
        body.threadRootId,
        "threadRootId",
        160,
      );
      const existing = sourceId
        ? events.find((event) =>
            event.tags.some(
              (tag) => tag[0] === "client" && tag[1] === sourceId,
            ),
          )
        : undefined;
      if (existing)
        return { handled: true, value: { event: existing, replayed: true } };
      await context.beforeMessagePost?.({
        channel,
        content,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      const mentions = validatedAgentIds(
        normalizedChannelMentions({
          availableAgentIds: context.availableAgentIds,
          content,
          explicitMentions: Array.isArray(body.mentions)
            ? body.mentions.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        }),
        context.availableAgentIds,
        false,
      );
      const invitedAgentIds = mentions.filter(
        (agentId) => !channel.agentIds.includes(agentId),
      );
      if (invitedAgentIds.length > 0) {
        ensureChannelPermission(channel, context.actor, "manage_members");
        await context.channelStore.addAgents(
          workspaceId,
          channel.id,
          invitedAgentIds,
        );
        await emitMemberAddedEvent({
          context,
          workspaceId,
          channel,
          agentIds: invitedAgentIds,
          userIds: [],
          ...(sourceId ? { sourceId: `${sourceId}:mentioned-members` } : {}),
        });
        await context.onChannelsChanged?.();
      }
      const event = createChannelEvent({
        workspaceId,
        channelId: channel.id,
        actor: context.actor,
        content,
        mentions,
        threadRootId: requestedThreadRootId
          ? resolveChannelMessageId(events, requestedThreadRootId)
          : undefined,
        sourceId,
      });
      await append(context, workspaceId, event);
      if (mentions.length > 0) {
        await context.onAgentMentions?.(channel, event, mentions);
      }
      await context.channelStore.audit(
        workspaceId,
        channel.id,
        "message.posted",
        context.actor,
        { eventId: event.id },
      );
      return { handled: true, value: { event } };
    }

    const repliesMatch = /^messages\/([^/]+)\/replies$/.exec(tail);
    if (repliesMatch?.[1] && request.method === "GET") {
      const messageId = decodeURIComponent(repliesMatch[1]);
      if (!messageById(events, messageId, context.actor))
        fail("Message was not found.", 404, "message_not_found");
      const page = cursorPage(
        threadMessages(events, messageId, context.actor),
        {
          cursor: url.searchParams.get("cursor"),
          limit: numberQuery(url, "limit", 50),
          newestFirst: false,
        },
      );
      return {
        handled: true,
        value: { messages: page.items, nextCursor: page.nextCursor },
      };
    }

    const reactionsMatch = /^messages\/([^/]+)\/reactions(?:\/([^/]+))?$/.exec(
      tail,
    );
    if (reactionsMatch?.[1]) {
      const messageId = decodeURIComponent(reactionsMatch[1]);
      const message = messageById(events, messageId, context.actor);
      if (!message) fail("Message was not found.", 404, "message_not_found");
      if (!reactionsMatch[2] && request.method === "GET") {
        return { handled: true, value: { reactions: message.reactions } };
      }
      if (!reactionsMatch[2] && request.method === "POST") {
        const emoji = textValue(body.emoji, "emoji", 80);
        const duplicate = events.find(
          (event) =>
            event.kind === 7 &&
            event.content === emoji &&
            event.actor.type === context.actor.type &&
            event.actor.id === context.actor.id &&
            event.tags.some((tag) => tag[0] === "e" && tag[1] === messageId) &&
            !events.some(
              (candidate) =>
                candidate.kind === 5 &&
                candidate.tags.some(
                  (tag) => tag[0] === "e" && tag[1] === event.id,
                ),
            ),
        );
        if (duplicate)
          return { handled: true, value: { event: duplicate, replayed: true } };
        const event = createChannelReaction({
          workspaceId,
          channelId: channel.id,
          targetEventId: messageId,
          actor: context.actor,
          reaction: emoji,
        });
        await append(context, workspaceId, event);
        await context.channelStore.audit(
          workspaceId,
          channel.id,
          "reaction.added",
          context.actor,
          { eventId: event.id, messageId, emoji },
        );
        return { handled: true, value: { event } };
      }
      if (reactionsMatch[2] && request.method === "DELETE") {
        const emoji = decodeURIComponent(reactionsMatch[2]);
        const reaction = [...events]
          .reverse()
          .find(
            (event) =>
              event.kind === 7 &&
              event.content === emoji &&
              event.actor.type === context.actor.type &&
              event.actor.id === context.actor.id &&
              event.tags.some((tag) => tag[0] === "e" && tag[1] === messageId),
          );
        if (!reaction) return { handled: true, value: { removed: false } };
        const deletion = createChannelDeletion({
          workspaceId,
          channelId: channel.id,
          targetEventId: reaction.id,
          actor: context.actor,
          reason: "reaction removed",
        });
        await append(context, workspaceId, deletion);
        await context.channelStore.audit(
          workspaceId,
          channel.id,
          "reaction.removed",
          context.actor,
          { reactionId: reaction.id, messageId, emoji },
        );
        return { handled: true, value: { removed: true, event: deletion } };
      }
    }

    const messageMatch = /^messages\/([^/]+)$/.exec(tail);
    if (messageMatch?.[1]) {
      const messageId = decodeURIComponent(messageMatch[1]);
      const message = messageById(events, messageId, context.actor);
      if (!message) fail("Message was not found.", 404, "message_not_found");
      if (request.method === "GET")
        return {
          handled: true,
          value: {
            message: withThreadContext(events, message, context.actor),
          },
        };
      if (!actorOwnsMessage(message, context.actor))
        fail(
          "Only the author can change this message.",
          403,
          "message_not_owned",
        );
      if (request.method === "PATCH") {
        const rawContent = textValue(body.content, "content", 8_000);
        const expectedVersion =
          typeof body.expectedVersion === "number"
            ? body.expectedVersion
            : undefined;
        if (
          expectedVersion !== undefined &&
          expectedVersion !== message.version
        )
          fail("Message changed since it was read.", 409, "write_conflict");
        const event = createChannelMessageEdit({
          workspaceId,
          channelId: channel.id,
          targetEventId: message.id,
          actor: context.actor,
          content:
            context.actor.type === "agent"
              ? normalizeAgentText(rawContent)
              : rawContent,
          sourceId: optionalText(body.idempotencyKey, "idempotencyKey", 120),
        });
        await append(context, workspaceId, event);
        await context.channelStore.audit(
          workspaceId,
          channel.id,
          "message.edited",
          context.actor,
          { eventId: event.id, messageId },
        );
        return {
          handled: true,
          value: {
            event,
            message: messageById([...events, event], messageId, context.actor),
          },
        };
      }
      if (request.method === "DELETE") {
        if (message.deleted)
          return { handled: true, value: { message, replayed: true } };
        const event = createChannelDeletion({
          workspaceId,
          channelId: channel.id,
          targetEventId: message.id,
          actor: context.actor,
          reason: optionalText(body.reason, "reason", 240),
        });
        await append(context, workspaceId, event);
        await context.channelStore.audit(
          workspaceId,
          channel.id,
          "message.deleted",
          context.actor,
          { eventId: event.id, messageId },
        );
        return {
          handled: true,
          value: {
            event,
            message: messageById([...events, event], messageId, context.actor),
          },
        };
      }
    }
    return { handled: false };
  } catch (error) {
    if (error instanceof ChannelApiFailure) {
      return {
        handled: true,
        status: error.status,
        value: { error: error.message, code: error.code },
      };
    }
    throw error;
  }
}
