import type { ChannelGuestRow } from "./queries/channel-guests/guests";
import type { ChannelRow } from "./workspace-channel-store";
import {
  channelGuestOutboxDeleteForGuest,
  channelGuestOutboxNext,
  channelGuestSubscriptionsDeleteForGuest,
} from "./queries/channel-guests/delivery";
import {
  channelGuestsListForConversation,
  channelGuestsUpdate,
} from "./queries/channel-guests/guests";
import { channelsUpdateChannelsExternal } from "./queries/channels/update-channels-external";

/** Ends a guest for good: credential, webhook, subscriptions and queue. */
export function revokeGuest(
  storage: DurableObjectStorage,
  guest: ChannelGuestRow,
) {
  if (guest.status === "removed") return;
  channelGuestsUpdate(storage, guest.guest_id, {
    status: "removed",
    removed_at: new Date().toISOString(),
    webhook_url: null,
    webhook_authorization: null,
    webhook_secret: null,
  });
  channelGuestSubscriptionsDeleteForGuest(storage, guest.guest_id);
  channelGuestOutboxDeleteForGuest(storage, guest.guest_id);
}

/**
 * Makes a channel internal: its link is deleted and every guest is removed for
 * good, so making it external again later never quietly readmits anyone. Call
 * inside the caller's transaction.
 */
export function closeExternalChannel(
  storage: DurableObjectStorage,
  conversationId: string,
) {
  channelsUpdateChannelsExternal(storage, {
    externalLinkToken: null,
    updatedAt: new Date().toISOString(),
    conversationId,
  });
  for (const guest of channelGuestsListForConversation(
    storage,
    conversationId,
    ["active"],
  )) {
    revokeGuest(storage, guest);
  }
}

/**
 * The single gate for anything a guest can do. Only a channel explicitly made
 * external admits guests; public and private channels never do. Private and
 * archived channels are closed when they change, and are refused here too.
 */
export function isExternalChannel(channel: ChannelRow) {
  return (
    channel.kind === "channel" &&
    Number(channel.is_private) === 0 &&
    Number(channel.archived) === 0 &&
    channel.external_link_token !== null
  );
}

/** When the next guest wake-up or retry is due, so the workspace alarm never
 * drops it while recomputing its own schedule. */
export function channelGuestOutboxDeadline(storage: DurableObjectStorage) {
  const next = channelGuestOutboxNext(storage);
  return next ? Date.parse(next.next) : undefined;
}
