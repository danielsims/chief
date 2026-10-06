import type { ChannelGuestRow } from "./queries/channel-guests/guests";
import {
  channelGuestOutboxDeleteForGuest,
  channelGuestOutboxNext,
  channelGuestSubscriptionsDeleteForGuest,
} from "./queries/channel-guests/delivery";
import {
  channelGuestsListForConversation,
  channelGuestsUpdate,
} from "./queries/channel-guests/guests";
import { channelGuestInvitesDeleteForConversation } from "./queries/channel-guests/invites";

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
 * Removes every agent from a channel for good, with any unused invites to
 * it. Called when the channel is archived or deleted. Call inside the
 * caller's transaction.
 */
export function revokeChannelAgents(
  storage: DurableObjectStorage,
  conversationId: string,
) {
  channelGuestInvitesDeleteForConversation(storage, conversationId);
  for (const guest of channelGuestsListForConversation(
    storage,
    conversationId,
    ["active"],
  )) {
    revokeGuest(storage, guest);
  }
}

/** When the next guest wake-up or retry is due, so the workspace alarm never
 * drops it while recomputing its own schedule. */
export function channelGuestOutboxDeadline(storage: DurableObjectStorage) {
  const next = channelGuestOutboxNext(storage);
  return next ? Date.parse(next.next) : undefined;
}
