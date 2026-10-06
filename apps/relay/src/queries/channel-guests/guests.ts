import { and, count, desc, eq, gte, inArray } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import {
  channelGuests,
  channelGuestThreads,
} from "../../db/schema/channel-guests";

export type ChannelGuestRow = typeof channelGuests.$inferSelect;

export function channelGuestsInsert(
  storage: DurableObjectStorage,
  row: ChannelGuestRow,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() => db.insert(channelGuests).values(row).run());
}

export function channelGuestsFind(
  storage: DurableObjectStorage,
  guestId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select()
      .from(channelGuests)
      .where(eq(channelGuests.guest_id, guestId))
      .get(),
  );
}

export function channelGuestsFindByTokenHash(
  storage: DurableObjectStorage,
  tokenHash: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select()
      .from(channelGuests)
      .where(eq(channelGuests.token_hash, tokenHash))
      .get(),
  );
}

export function channelGuestsListForConversation(
  storage: DurableObjectStorage,
  conversationId: string,
  statuses: readonly string[],
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select()
      .from(channelGuests)
      .where(
        and(
          eq(channelGuests.conversation_id, conversationId),
          inArray(channelGuests.status, [...statuses]),
        ),
      )
      .orderBy(desc(channelGuests.created_at))
      .all(),
  );
}

export function channelGuestsUpdate(
  storage: DurableObjectStorage,
  guestId: string,
  set: Partial<Omit<ChannelGuestRow, "guest_id">>,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .update(channelGuests)
      .set(set)
      .where(eq(channelGuests.guest_id, guestId))
      .run(),
  );
}

/** Unapproved requests expire; drop them so codes and names stay reusable. */
export function channelGuestThreadsInsert(
  storage: DurableObjectStorage,
  guestId: string,
  threadRootId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .insert(channelGuestThreads)
      .values({ guest_id: guestId, thread_root_id: threadRootId })
      .onConflictDoNothing()
      .run(),
  );
}

export function channelGuestThreadsHas(
  storage: DurableObjectStorage,
  guestId: string,
  threadRootId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db
        .select()
        .from(channelGuestThreads)
        .where(
          and(
            eq(channelGuestThreads.guest_id, guestId),
            eq(channelGuestThreads.thread_root_id, threadRootId),
          ),
        )
        .get() !== undefined,
  );
}

/** Joins in a channel since `since`, removed guests included, so leaving and
 * rejoining cannot get around the cap. */
export function channelGuestsCountJoinedSince(
  storage: DurableObjectStorage,
  conversationId: string,
  since: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db
        .select({ joined: count() })
        .from(channelGuests)
        .where(
          and(
            eq(channelGuests.conversation_id, conversationId),
            gte(channelGuests.created_at, since),
          ),
        )
        .get()?.joined ?? 0,
  );
}
