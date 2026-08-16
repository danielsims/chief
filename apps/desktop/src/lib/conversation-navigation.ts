/** Keeps the owning thread durable while nested conversation panels open. */
export function withConversationThread(
  current: URLSearchParams,
  threadRootId: string | null,
) {
  const next = new URLSearchParams(current);
  if (threadRootId) {
    next.set("thread", threadRootId);
    next.delete("activity");
    next.delete("child");
    next.delete("profile");
  } else {
    next.delete("thread");
  }
  return next;
}

/** Opens a child without changing the channel or DM that owns it. */
export function withConversationChild(
  current: URLSearchParams,
  childId: string,
  chatId: string,
  channelId?: string,
) {
  const next = new URLSearchParams(current);
  if (channelId) next.set("channel", channelId);
  next.set("chat", chatId);
  next.delete("profile");
  next.set("child", childId);
  return next;
}

/** Opens nested work in the channel or DM that actually owns its session. */
export function withOwnedConversationChild(
  current: URLSearchParams,
  child: {
    id: string;
    parentId?: string;
    triggerContext?: Record<string, unknown>;
  },
  channels: readonly {
    id: string;
    visibility?: string;
    agentIds: readonly string[];
  }[],
) {
  const next = new URLSearchParams(current);
  const parentId = child.parentId;
  const channelId = parentId?.startsWith("channel:")
    ? parentId.slice(parentId.lastIndexOf(":") + 1)
    : null;
  const channel = channelId
    ? channels.find((candidate) => candidate.id === channelId)
    : undefined;
  next.delete("activity");
  next.delete("profile");
  next.delete("channel");
  next.delete("dm");
  next.delete("chat");
  if (channel?.visibility === "direct" && channel.agentIds[0]) {
    next.set("dm", channel.agentIds[0]);
  } else if (channel) {
    next.set("channel", channel.id);
  } else if (parentId) {
    next.set("chat", parentId);
  }
  const threadRootId = child.triggerContext?.threadRootId;
  if (typeof threadRootId === "string" && threadRootId) {
    next.set("thread", threadRootId);
  } else {
    next.delete("thread");
  }
  next.set("child", child.id);
  return next;
}

/** Resolves a task globally before falling back to the active conversation. */
export function withResolvedConversationChild(
  current: URLSearchParams,
  childId: string,
  sessions: readonly {
    id: string;
    parentId?: string;
    triggerContext?: Record<string, unknown>;
  }[],
  channels: readonly {
    id: string;
    visibility?: string;
    agentIds: readonly string[];
  }[],
  fallbackChatId: string | null,
  fallbackChannelId?: string,
) {
  const child = sessions.find((session) => session.id === childId);
  if (child) return withOwnedConversationChild(current, child, channels);
  const owningChatId = fallbackChatId ?? current.get("chat");
  return owningChatId
    ? withConversationChild(current, childId, owningChatId, fallbackChannelId)
    : current;
}

/** Closing nested work preserves its thread return destination. */
export function withoutConversationChild(
  current: URLSearchParams,
  returnThreadRootId?: string,
) {
  const next = new URLSearchParams(current);
  next.delete("child");
  if (returnThreadRootId) next.set("thread", returnThreadRootId);
  else next.delete("thread");
  return next;
}
