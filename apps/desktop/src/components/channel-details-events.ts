import { z } from "zod";

import type { ChannelDetailsTab } from "./channel-details-dialog";

export const CHANNEL_DETAILS_EVENT = "chief:open-channel-details";

const channelDetailsRequestSchema = z.object({
  channelId: z.string().min(1),
  tab: z.enum(["about", "members", "agents", "settings"]),
});

/** Opens a channel's details dialog from anywhere in the app. */
export function openChannelDetails(channelId: string, tab: ChannelDetailsTab) {
  window.dispatchEvent(
    new CustomEvent(CHANNEL_DETAILS_EVENT, { detail: { channelId, tab } }),
  );
}

export function channelDetailsRequest(event: Event) {
  if (!(event instanceof CustomEvent)) return null;
  const parsed = channelDetailsRequestSchema.safeParse(event.detail);
  return parsed.success ? parsed.data : null;
}
