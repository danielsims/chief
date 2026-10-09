export interface ConversationRouteChannel {
  id: string;
  slug: string;
  visibility?: string;
  directUserId?: string;
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
  // An agent's own DM, never a person DM or group that merely includes it.
  // Otherwise reading the DM marks a different conversation read and its
  // unread badge never clears.
  const agentDirect = requestedDm
    ? channels.find(
        (channel) =>
          channel.visibility === "direct" &&
          !channel.directUserId &&
          channel.agentIds[0] === requestedDm,
      )
    : undefined;
  if (agentDirect) return agentDirect;
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
