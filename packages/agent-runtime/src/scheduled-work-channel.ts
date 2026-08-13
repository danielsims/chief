import type { WorkspaceChannel } from "./channel-types.js";
import type { RecurringWorkRecord } from "./types.js";
import { channelChatId, channelIdFromChatId } from "./channels/nip29.js";

const AGENT_CHANNEL_SLUGS: Readonly<Record<string, string>> = {
  ads: "advertising",
  analyst: "analytics",
  brand: "marketing",
  content: "marketing",
  prospector: "prospecting",
};

export function preferredScheduledChannel(
  channels: readonly WorkspaceChannel[],
  work: Pick<RecurringWorkRecord, "agentId" | "conversationId" | "id">,
  missionChannelId: string,
) {
  const explicitId = work.conversationId
    ? channelIdFromChatId(work.conversationId)
    : null;
  const explicit = explicitId
    ? channels.find((channel) => channel.id === explicitId)
    : undefined;
  const isLegacyOnboardingDestination =
    work.id.startsWith("onboarding-") && explicit?.id === missionChannelId;
  if (explicit && !isLegacyOnboardingDestination) return explicit;

  const preferredSlug = AGENT_CHANNEL_SLUGS[work.agentId];
  return (
    channels.find(
      (channel) =>
        channel.lifecycle === "active" && channel.slug === preferredSlug,
    ) ?? channels.find((channel) => channel.id === missionChannelId)
  );
}

export function scheduledChannelConversationId(
  workspaceId: string,
  channel: WorkspaceChannel,
) {
  return channelChatId(workspaceId, channel.id);
}
