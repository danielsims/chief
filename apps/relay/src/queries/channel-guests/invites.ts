import { eq, lt } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { channelGuestInvites } from "../../db/schema/channel-guests";

export type ChannelGuestInviteRow = typeof channelGuestInvites.$inferSelect;

export function channelGuestInvitesInsert(
  storage: DurableObjectStorage,
  row: ChannelGuestInviteRow,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.insert(channelGuestInvites).values(row).run(),
  );
}

export function channelGuestInvitesDelete(
  storage: DurableObjectStorage,
  tokenHash: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .delete(channelGuestInvites)
      .where(eq(channelGuestInvites.token_hash, tokenHash))
      .run(),
  );
}

export function channelGuestInvitesDeleteForConversation(
  storage: DurableObjectStorage,
  conversationId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .delete(channelGuestInvites)
      .where(eq(channelGuestInvites.conversation_id, conversationId))
      .run(),
  );
}

export function channelGuestInvitesDeleteExpired(
  storage: DurableObjectStorage,
  now: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .delete(channelGuestInvites)
      .where(lt(channelGuestInvites.expires_at, now))
      .run(),
  );
}

export function channelGuestInvitesFind(
  storage: DurableObjectStorage,
  tokenHash: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select()
      .from(channelGuestInvites)
      .where(eq(channelGuestInvites.token_hash, tokenHash))
      .get(),
  );
}
