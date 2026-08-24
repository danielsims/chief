import type { ChannelEvent } from "@chief/agent-runtime/types";
import { isJsonNumber, isJsonObject } from "@chief/relay-contracts";

export interface ChannelReadStateBlob {
  v: 1;
  contexts: Record<string, number>;
}

export interface ObservedChannelMessage {
  id: string;
  channelId: string;
  createdAt: number;
  rootId: string | null;
  sourceId: string | null;
  threadSourceId: string | null;
  content: string;
  actor: ChannelEvent["actor"];
}

export const EMPTY_CHANNEL_READ_STATE: ChannelReadStateBlob = {
  v: 1,
  contexts: {},
};

export function channelContextKey(channelId: string) {
  return `channel:${channelId}`;
}

export function threadContextKey(channelId: string, rootId: string) {
  return `thread:${channelId}:${rootId}`;
}

export function tagValue(
  event: Pick<ChannelEvent, "tags">,
  name: string,
  marker?: string,
) {
  return (
    event.tags.find(
      (tag) => tag[0] === name && (marker === undefined || tag[3] === marker),
    )?.[1] ?? null
  );
}

export function channelEventThreadRootId(event: ChannelEvent) {
  return tagValue(event, "e", "root");
}

export function channelEventSourceId(event: ChannelEvent) {
  return tagValue(event, "client");
}

export function isOwnChannelEvent(event: ChannelEvent) {
  return (
    event.actor.type === "user" &&
    (event.actor.id === "workspace-owner" || event.actor.name === "You")
  );
}

export function observedChannelMessage(
  event: ChannelEvent,
): ObservedChannelMessage | null {
  if (
    event.kind !== 9 ||
    isOwnChannelEvent(event) ||
    event.tags.some((tag) => tag[0] === "notification" && tag[1] === "silent")
  )
    return null;
  const sourceId = channelEventSourceId(event);
  return {
    id: sourceId ?? event.id,
    channelId: event.channelId,
    createdAt: event.createdAt,
    rootId: channelEventThreadRootId(event),
    sourceId,
    threadSourceId: null,
    content: event.content,
    actor: event.actor,
  };
}

export function parseChannelReadState(value: unknown): ChannelReadStateBlob {
  if (!value || !isJsonObject(value)) return EMPTY_CHANNEL_READ_STATE;
  const candidate = value as Partial<ChannelReadStateBlob>;
  if (candidate.v !== 1 || !candidate.contexts) {
    return EMPTY_CHANNEL_READ_STATE;
  }
  const contexts = Object.fromEntries(
    Object.entries(candidate.contexts).filter(
      (entry): entry is [string, number] =>
        isJsonNumber(entry[1]) && Number.isFinite(entry[1]) && entry[1] >= 0,
    ),
  );
  return { v: 1, contexts };
}

export function advanceReadContext(
  state: ChannelReadStateBlob,
  context: string,
  timestamp: number,
) {
  if ((state.contexts[context] ?? -1) >= timestamp) return state;
  return {
    v: 1 as const,
    contexts: { ...state.contexts, [context]: timestamp },
  };
}

export function effectiveReadAt(
  state: ChannelReadStateBlob,
  message: ObservedChannelMessage,
) {
  const channelReadAt = state.contexts[channelContextKey(message.channelId)];
  if (!message.rootId) return channelReadAt ?? null;
  const threadReadAt =
    state.contexts[threadContextKey(message.channelId, message.rootId)];
  if (channelReadAt === undefined) return threadReadAt ?? null;
  if (threadReadAt === undefined) return channelReadAt;
  return Math.max(channelReadAt, threadReadAt);
}

export function isUnreadChannelMessage(
  state: ChannelReadStateBlob,
  message: ObservedChannelMessage,
) {
  const readAt = effectiveReadAt(state, message);
  return readAt === null || message.createdAt > readAt;
}

export function unreadCountsByChannel(
  state: ChannelReadStateBlob,
  messages: Iterable<ObservedChannelMessage>,
) {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (!isUnreadChannelMessage(state, message)) continue;
    counts.set(message.channelId, (counts.get(message.channelId) ?? 0) + 1);
  }
  return counts;
}

export function mergeObservedMessageSnapshot(
  snapshot: ReadonlyMap<string, ObservedChannelMessage>,
  current: ReadonlyMap<string, ObservedChannelMessage> | undefined,
  liveMessageIds: ReadonlySet<string>,
) {
  const merged = new Map(snapshot);
  for (const [id, message] of current ?? []) {
    if (liveMessageIds.has(id) && !merged.has(id)) merged.set(id, message);
  }
  return merged;
}
