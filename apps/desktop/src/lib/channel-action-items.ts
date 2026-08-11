import type {
  ActionItem,
  RecurringWorkRecord,
  SessionRecord,
} from "@chief/agent-runtime/types";

import { channelIdFromChatId, WORKSPACE_CHANNELS } from "./workspace-channels";

function availableChannelId(
  candidate: string | null,
  availableIds: ReadonlySet<string>,
) {
  if (!candidate) return null;
  if (availableIds.has(candidate)) return candidate;
  const productChannel = WORKSPACE_CHANNELS.find(
    (channel) => channel.relayId === candidate,
  );
  return productChannel && availableIds.has(productChannel.id)
    ? productChannel.id
    : null;
}

function sessionChannelId(
  sourceId: string,
  sessionsById: ReadonlyMap<string, SessionRecord>,
) {
  const visited = new Set<string>();
  let session = sessionsById.get(sourceId);

  while (session && !visited.has(session.id)) {
    visited.add(session.id);
    const ownChannelId = channelIdFromChatId(session.id);
    if (ownChannelId) return ownChannelId;
    const parentChannelId = channelIdFromChatId(session.parentId ?? null);
    if (parentChannelId) return parentChannelId;
    session = session.parentId ? sessionsById.get(session.parentId) : undefined;
  }

  return null;
}

/**
 * Finds channels with an unresolved action raised from that channel's durable
 * conversation, thread, specialist session, or scheduled occurrence.
 */
export function channelIdsNeedingUser({
  actionItems,
  sessions,
  recurringWork,
  channelIds,
}: {
  actionItems: readonly ActionItem[];
  sessions: readonly SessionRecord[];
  recurringWork: readonly RecurringWorkRecord[];
  channelIds: readonly string[];
}) {
  const result = new Set<string>();
  const availableIds = new Set(channelIds);
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  const recurringWorkBySource = new Map(
    recurringWork.map((work) => [`automation-${work.id}`, work]),
  );

  for (const action of actionItems) {
    if (action.status !== "open" || !action.sourceId) continue;

    const scheduledConversationId = recurringWorkBySource.get(
      action.sourceId,
    )?.conversationId;
    const candidate =
      channelIdFromChatId(action.sourceId) ??
      sessionChannelId(action.sourceId, sessionsById) ??
      channelIdFromChatId(scheduledConversationId ?? null) ??
      action.sourceId;
    const channelId = availableChannelId(candidate, availableIds);
    if (channelId) result.add(channelId);
  }

  return result;
}
