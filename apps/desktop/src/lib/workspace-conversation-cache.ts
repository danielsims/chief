import type {
  ChannelEvent,
  ChiefUIMessage,
  DriverType,
  WorkspaceChannel,
} from "@chief/agent-runtime/types";

const MAX_CACHED_CONVERSATIONS = 24;

interface WorkspaceConversationCache {
  workspaceId: string;
  channelEvents: Map<string, ChannelEvent[]>;
  channels?: WorkspaceChannel[];
  chats?: WorkspaceChatSummary[];
  hydratedConversations: Map<string, true>;
  transcripts: Map<string, ChiefUIMessage[]>;
}

export interface WorkspaceChatSummary {
  id: string;
  agent: string;
  title: string;
  lastText: string;
  lastAt: number;
  driver?: DriverType;
  model?: string;
  running: boolean;
}

let activeCache: WorkspaceConversationCache | null = null;

function setBounded<Value>(map: Map<string, Value>, key: string, value: Value) {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_CACHED_CONVERSATIONS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * Establishes a renderer-local tenant boundary. Switching workspaces discards
 * every cached transcript and channel event from the prior workspace; late
 * responses for that workspace are ignored by the setters below.
 */
export function activateWorkspaceConversationCache(workspaceId: string | null) {
  if (activeCache?.workspaceId === workspaceId) return;
  activeCache = workspaceId
    ? {
        workspaceId,
        channelEvents: new Map(),
        hydratedConversations: new Map(),
        transcripts: new Map(),
      }
    : null;
}

function conversationHydrationKey(
  chatId: string,
  surface: "direct" | "channel",
  channelId?: string,
) {
  return `${surface}:${chatId}:${channelId ?? ""}`;
}

/**
 * Records that a conversation has completed its first renderable load. This is
 * intentionally separate from request state: revisits keep showing the cached
 * timeline while history and channel events revalidate in the background.
 */
export function markConversationHydrated(
  workspaceId: string,
  chatId: string,
  surface: "direct" | "channel",
  channelId?: string,
) {
  if (activeCache?.workspaceId !== workspaceId) return false;
  setBounded(
    activeCache.hydratedConversations,
    conversationHydrationKey(chatId, surface, channelId),
    true,
  );
  return true;
}

export function isConversationHydrated(
  workspaceId: string,
  chatId: string,
  surface: "direct" | "channel",
  channelId?: string,
) {
  if (activeCache?.workspaceId !== workspaceId) return false;
  if (
    !activeCache.hydratedConversations.has(
      conversationHydrationKey(chatId, surface, channelId),
    ) ||
    !activeCache.transcripts.has(chatId)
  ) {
    return false;
  }
  return surface === "direct"
    ? true
    : Boolean(channelId && activeCache.channelEvents.has(channelId));
}

export function cachedTranscript(workspaceId: string, chatId: string) {
  return activeCache?.workspaceId === workspaceId
    ? activeCache.transcripts.get(chatId)
    : undefined;
}

export function cacheTranscript(
  workspaceId: string,
  chatId: string,
  messages: ChiefUIMessage[],
) {
  if (activeCache?.workspaceId !== workspaceId) return false;
  setBounded(activeCache.transcripts, chatId, messages);
  return true;
}

export function cachedChannelEvents(workspaceId: string, channelId: string) {
  return activeCache?.workspaceId === workspaceId
    ? activeCache.channelEvents.get(channelId)
    : undefined;
}

/**
 * Reconciles a relay snapshot with events already observed on the live stream.
 * Relay snapshots are bounded and can finish after a newer subscription event,
 * so absence from a snapshot is not evidence that an event was deleted.
 */
export function reconcileChannelEvents(
  current: readonly ChannelEvent[],
  snapshot: readonly ChannelEvent[],
) {
  const eventsById = new Map(current.map((event) => [event.id, event]));
  for (const event of snapshot) eventsById.set(event.id, event);
  return [...eventsById.values()].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

export function cacheChannelEvents(
  workspaceId: string,
  channelId: string,
  events: ChannelEvent[],
) {
  if (activeCache?.workspaceId !== workspaceId) return false;
  const current = activeCache.channelEvents.get(channelId) ?? [];
  setBounded(
    activeCache.channelEvents,
    channelId,
    reconcileChannelEvents(current, events),
  );
  return true;
}

/**
 * Keeps a live event received by a workspace-wide observer in the same cache
 * used by the channel surface. This makes navigating from Inbox or a native
 * notification show the event immediately, before the channel revalidation
 * response arrives.
 */
export function cacheChannelEvent(workspaceId: string, event: ChannelEvent) {
  if (activeCache?.workspaceId !== workspaceId) return false;
  const current = activeCache.channelEvents.get(event.channelId) ?? [];
  setBounded(
    activeCache.channelEvents,
    event.channelId,
    reconcileChannelEvents(current, [event]),
  );
  return true;
}

export function cachedWorkspaceChannels(workspaceId: string) {
  return activeCache?.workspaceId === workspaceId
    ? activeCache.channels
    : undefined;
}

export function cacheWorkspaceChannels(
  workspaceId: string,
  channels: WorkspaceChannel[],
) {
  if (activeCache?.workspaceId !== workspaceId) return false;
  activeCache.channels = channels;
  return true;
}

export function cachedWorkspaceChats(workspaceId: string) {
  return activeCache?.workspaceId === workspaceId
    ? activeCache.chats
    : undefined;
}

export function cacheWorkspaceChats(
  workspaceId: string,
  chats: WorkspaceChatSummary[],
) {
  if (activeCache?.workspaceId !== workspaceId) return false;
  activeCache.chats = chats;
  return true;
}
