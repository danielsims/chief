/** Keeps the owning thread durable while nested conversation panels open. */
export function withConversationThread(
  current: URLSearchParams,
  threadRootId: string | null,
) {
  const next = new URLSearchParams(current);
  if (threadRootId) next.set("thread", threadRootId);
  else next.delete("thread");
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
