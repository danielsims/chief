export interface MessageDeepLinkTarget {
  channelId: string;
  channelSlug?: string | null;
  directAgentId?: string | null;
  messageId: string;
  threadRootId?: string | null;
}

type MessageDeepLinkListener = (target: MessageDeepLinkTarget) => void;

const listeners = new Set<MessageDeepLinkListener>();
let pendingTarget: MessageDeepLinkTarget | null = null;

function nonEmpty(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function parseMessageDeepLink(
  url: string,
): MessageDeepLinkTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const action = parsed.hostname || parsed.pathname.replace(/^\/+/, "");
  if (parsed.protocol !== "chief-desktop:" || action !== "message") return null;
  const channelId = nonEmpty(
    parsed.searchParams.get("channelId") ?? parsed.searchParams.get("channel"),
  );
  const messageId = nonEmpty(
    parsed.searchParams.get("messageId") ?? parsed.searchParams.get("message"),
  );
  if (!channelId || !messageId) return null;
  const channelSlug = nonEmpty(parsed.searchParams.get("channelSlug"));
  const directAgentId = nonEmpty(parsed.searchParams.get("dm"));
  const threadRootId = nonEmpty(
    parsed.searchParams.get("threadRootId") ??
      parsed.searchParams.get("thread"),
  );
  return {
    channelId,
    messageId,
    ...(channelSlug ? { channelSlug } : {}),
    ...(directAgentId ? { directAgentId } : {}),
    ...(threadRootId ? { threadRootId } : {}),
  };
}

export function messageDeepLinkUrl(target: MessageDeepLinkTarget) {
  const url = new URL("chief-desktop://message");
  url.searchParams.set("channelId", target.channelId);
  url.searchParams.set("messageId", target.messageId);
  if (target.channelSlug)
    url.searchParams.set("channelSlug", target.channelSlug);
  if (target.directAgentId) url.searchParams.set("dm", target.directAgentId);
  if (target.threadRootId)
    url.searchParams.set("threadRootId", target.threadRootId);
  return url.toString();
}

export function routeForMessageDeepLink(target: MessageDeepLinkTarget) {
  const params = new URLSearchParams();
  if (target.directAgentId) params.set("dm", target.directAgentId);
  else params.set("channel", target.channelSlug ?? target.channelId);
  if (target.threadRootId) params.set("thread", target.threadRootId);
  params.set("message", target.messageId);
  return `/conversations?${params.toString()}`;
}

export function dispatchMessageDeepLink(target: MessageDeepLinkTarget) {
  if (listeners.size === 0) {
    pendingTarget = target;
    return;
  }
  pendingTarget = null;
  for (const listener of listeners) listener(target);
}

export function listenForMessageDeepLinks(listener: MessageDeepLinkListener) {
  listeners.add(listener);
  if (pendingTarget) {
    const target = pendingTarget;
    pendingTarget = null;
    listener(target);
  }
  return () => {
    listeners.delete(listener);
  };
}
