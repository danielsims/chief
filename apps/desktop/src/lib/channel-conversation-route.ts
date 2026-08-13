export interface ConversationRouteChannel {
  id: string;
  slug: string;
  visibility?: string;
  agentIds: readonly string[];
}

export function channelForConversationRoute(
  pathname: string,
  search: string,
  channels: readonly ConversationRouteChannel[],
) {
  if (!pathname.startsWith("/conversations")) return undefined;
  const params = new URLSearchParams(search);
  const requested = params.get("channel");
  const requestedDm = params.get("dm");
  return channels.find(
    (channel) =>
      channel.id === requested ||
      channel.slug === requested ||
      (requestedDm !== null &&
        channel.visibility === "direct" &&
        channel.agentIds.includes(requestedDm)) ||
      (!requested && !requestedDm && channel.slug === "general"),
  );
}
