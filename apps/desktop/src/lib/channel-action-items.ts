import type {
  ActionItem,
  ChiefUIMessage,
  RecurringWorkRecord,
  SessionRecord,
} from "@chief/agent-runtime/types";
import { isJsonString } from "@chief/relay-contracts";

import type { WorkspaceAgentId } from "./workspace-channels";
import {
  channelIdFromChatId,
  directMessageAgentIdFromChatId,
  isWorkspaceAgentId,
  WORKSPACE_CHANNELS,
} from "./workspace-channels";

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

function directAgentIdFromConversationId(
  conversationId: string | null | undefined,
  directAgentsByConversationId: ReadonlyMap<string, WorkspaceAgentId>,
): WorkspaceAgentId | null {
  const mappedAgentId = conversationId
    ? directAgentsByConversationId.get(conversationId)
    : null;
  if (mappedAgentId) return mappedAgentId;
  const directAgentId = directMessageAgentIdFromChatId(conversationId ?? null);
  if (directAgentId) return directAgentId;
  if (!conversationId?.startsWith("dm:")) return null;
  const candidate = conversationId.slice(conversationId.lastIndexOf(":") + 1);
  return isWorkspaceAgentId(candidate) ? candidate : null;
}

function sessionDirectAgentId(
  sourceId: string,
  sessionsById: ReadonlyMap<string, SessionRecord>,
  directAgentsByConversationId: ReadonlyMap<string, WorkspaceAgentId>,
) {
  const directSource = directAgentIdFromConversationId(
    sourceId,
    directAgentsByConversationId,
  );
  if (directSource) return directSource;
  const visited = new Set<string>();
  let session = sessionsById.get(sourceId);

  while (session && !visited.has(session.id)) {
    visited.add(session.id);
    const ownAgentId = directAgentIdFromConversationId(
      session.id,
      directAgentsByConversationId,
    );
    if (ownAgentId) return ownAgentId;
    const parentAgentId = directAgentIdFromConversationId(
      session.parentId,
      directAgentsByConversationId,
    );
    if (parentAgentId) return parentAgentId;
    session = session.parentId ? sessionsById.get(session.parentId) : undefined;
  }

  return null;
}

function sessionThreadRootId(
  sourceId: string,
  sessionsById: ReadonlyMap<string, SessionRecord>,
) {
  const visited = new Set<string>();
  let session = sessionsById.get(sourceId);

  while (session && !visited.has(session.id)) {
    visited.add(session.id);
    const threadRootId = session.triggerContext?.threadRootId;
    if (isJsonString(threadRootId) && threadRootId) return threadRootId;
    session = session.parentId ? sessionsById.get(session.parentId) : undefined;
  }

  return null;
}

function sessionBelongsToConversation(
  sourceId: string,
  chatId: string,
  sessionsById: ReadonlyMap<string, SessionRecord>,
) {
  if (sourceId === chatId) return true;
  const visited = new Set<string>();
  let session = sessionsById.get(sourceId);
  while (session && !visited.has(session.id)) {
    visited.add(session.id);
    if (session.id === chatId || session.parentId === chatId) return true;
    session = session.parentId ? sessionsById.get(session.parentId) : undefined;
  }
  return false;
}

function isRenderableConversationAction(action: ActionItem) {
  if (action.status === "dismissed" || !action.request) return false;
  return !(
    action.status === "resolved" &&
    (action.request.fields.length > 0 || !action.request.questions?.length)
  );
}

export function actionAttentionTarget({
  action,
  recurringWork,
  sessions,
}: {
  action: ActionItem;
  recurringWork: readonly RecurringWorkRecord[];
  sessions: readonly SessionRecord[];
}) {
  if (action.status !== "open" || !action.sourceId) return null;
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  const scheduledConversationId = recurringWork.find(
    (work) => `automation-${work.id}` === action.sourceId,
  )?.conversationId;
  const channelId =
    channelIdFromChatId(action.sourceId) ??
    sessionChannelId(action.sourceId, sessionsById) ??
    channelIdFromChatId(scheduledConversationId ?? null);
  const threadRootId =
    action.threadRootId ?? sessionThreadRootId(action.sourceId, sessionsById);
  return channelId && threadRootId ? { channelId, threadRootId } : null;
}

/** Resolves each attention-marked channel to its exact owning thread. */
export function channelAttentionTargets({
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
  const targets = new Map<
    string,
    { threadRootId: string; messageId: string }
  >();
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
    const threadRootId =
      action.threadRootId ?? sessionThreadRootId(action.sourceId, sessionsById);
    if (channelId && threadRootId && !targets.has(channelId)) {
      targets.set(channelId, { threadRootId, messageId: action.id });
    }
  }

  return targets;
}

/** Resolves each attention-marked direct conversation to its exact action. */
export function directMessageAttentionTargets({
  actionItems,
  sessions,
  recurringWork,
  directMessageIds,
  directMessageChats = [],
}: {
  actionItems: readonly ActionItem[];
  sessions: readonly SessionRecord[];
  recurringWork: readonly RecurringWorkRecord[];
  directMessageIds: readonly WorkspaceAgentId[];
  directMessageChats?: readonly { id: string; agent: string }[];
}) {
  const targets = new Map<
    WorkspaceAgentId,
    { threadRootId?: string; messageId: string }
  >();
  const availableIds = new Set(directMessageIds);
  const directAgentsByConversationId = new Map<string, WorkspaceAgentId>();
  for (const chat of directMessageChats) {
    if (availableIds.has(chat.agent)) {
      directAgentsByConversationId.set(chat.id, chat.agent);
    }
  }
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
    const agentId =
      sessionDirectAgentId(
        action.sourceId,
        sessionsById,
        directAgentsByConversationId,
      ) ??
      directAgentIdFromConversationId(
        scheduledConversationId,
        directAgentsByConversationId,
      );
    if (!agentId || !availableIds.has(agentId) || targets.has(agentId)) {
      continue;
    }
    const threadRootId =
      action.threadRootId ?? sessionThreadRootId(action.sourceId, sessionsById);
    targets.set(agentId, {
      ...(threadRootId ? { threadRootId } : undefined),
      messageId: action.id,
    });
  }

  return targets;
}

export function threadRootIdsNeedingUser({
  actionItems,
  sessions,
}: {
  actionItems: readonly ActionItem[];
  sessions: readonly SessionRecord[];
}) {
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  return new Set(
    actionItems.flatMap((action) => {
      if (action.status !== "open" || !action.sourceId) return [];
      const threadRootId =
        action.threadRootId ??
        sessionThreadRootId(action.sourceId, sessionsById);
      return threadRootId ? [threadRootId] : [];
    }),
  );
}

/**
 * Recovers the owning root for actions written before threadRootId was stored.
 * New actions always use their host-bound threadRootId; this only keeps an
 * already-open local action discoverable after upgrading the desktop app.
 */
export function legacyThreadRootIdsNeedingUser({
  actionItems,
  chatId,
  messages,
}: {
  actionItems: readonly ActionItem[];
  chatId: string;
  messages: readonly ChiefUIMessage[];
}) {
  const roots = messages
    .filter((message) => !message.metadata?.threadRootId)
    .slice()
    .sort(
      (left, right) =>
        (left.metadata?.createdAt ?? 0) - (right.metadata?.createdAt ?? 0),
    );
  const result = new Set<string>();

  for (const action of actionItems) {
    if (
      action.status !== "open" ||
      action.threadRootId ||
      action.sourceId !== chatId
    ) {
      continue;
    }
    let root: ChiefUIMessage | undefined;
    for (const message of roots) {
      if (
        (message.metadata?.createdAt ?? Number.POSITIVE_INFINITY) >
        action.createdAt
      ) {
        break;
      }
      root = message;
    }
    if (root) result.add(root.id);
  }

  return result;
}

export function actionItemsInThread({
  actionItems,
  chatId,
  messages,
  sessions,
  threadRootId,
}: {
  actionItems: readonly ActionItem[];
  chatId: string;
  messages: readonly ChiefUIMessage[];
  sessions: readonly SessionRecord[];
  threadRootId: string;
}) {
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  return actionItems.filter((action) => {
    if (!isRenderableConversationAction(action)) return false;
    if (action.threadRootId === threadRootId) return true;
    if (
      action.sourceId &&
      sessionThreadRootId(action.sourceId, sessionsById) === threadRootId
    ) {
      return true;
    }
    return legacyThreadRootIdsNeedingUser({
      actionItems: [action],
      chatId,
      messages,
    }).has(threadRootId);
  });
}

/** Actions raised in a main DM or channel timeline, excluding thread actions. */
export function actionItemsInConversation({
  actionItems,
  chatId,
  sessions,
}: {
  actionItems: readonly ActionItem[];
  chatId: string;
  sessions: readonly SessionRecord[];
}) {
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  return actionItems.filter((action) => {
    if (!isRenderableConversationAction(action) || !action.sourceId) {
      return false;
    }
    if (
      action.threadRootId ||
      sessionThreadRootId(action.sourceId, sessionsById)
    ) {
      return false;
    }
    return sessionBelongsToConversation(action.sourceId, chatId, sessionsById);
  });
}

export function actionItemsNeedingUserInThread(
  input: Parameters<typeof actionItemsInThread>[0],
) {
  return actionItemsInThread(input).filter(
    (action) => action.status === "open",
  );
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
