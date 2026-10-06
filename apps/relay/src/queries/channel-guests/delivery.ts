import { and, asc, count, eq, lte } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import {
  channelGuestOutbox,
  channelGuestSubscriptions,
} from "../../db/schema/channel-guests";

export type ChannelGuestSubscriptionRow =
  typeof channelGuestSubscriptions.$inferSelect;
export type ChannelGuestOutboxRow = typeof channelGuestOutbox.$inferSelect;

export function channelGuestSubscriptionsUpsert(
  storage: DurableObjectStorage,
  row: ChannelGuestSubscriptionRow,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .insert(channelGuestSubscriptions)
      .values(row)
      .onConflictDoUpdate({
        target: channelGuestSubscriptions.subscription_id,
        set: {
          wake: row.wake,
          secret: row.secret,
          refresh_before: row.refresh_before,
        },
      })
      .run(),
  );
}

export function channelGuestSubscriptionsList(
  storage: DurableObjectStorage,
  guestId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select()
      .from(channelGuestSubscriptions)
      .where(eq(channelGuestSubscriptions.guest_id, guestId))
      .all(),
  );
}

export function channelGuestSubscriptionsFind(
  storage: DurableObjectStorage,
  subscriptionId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select()
      .from(channelGuestSubscriptions)
      .where(eq(channelGuestSubscriptions.subscription_id, subscriptionId))
      .get(),
  );
}

export function channelGuestSubscriptionsDelete(
  storage: DurableObjectStorage,
  subscriptionId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .delete(channelGuestSubscriptions)
      .where(eq(channelGuestSubscriptions.subscription_id, subscriptionId))
      .run(),
  );
}

export function channelGuestSubscriptionsDeleteForGuest(
  storage: DurableObjectStorage,
  guestId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .delete(channelGuestSubscriptions)
      .where(eq(channelGuestSubscriptions.guest_id, guestId))
      .run(),
  );
}

export function channelGuestOutboxInsert(
  storage: DurableObjectStorage,
  row: ChannelGuestOutboxRow,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.insert(channelGuestOutbox).values(row).onConflictDoNothing().run(),
  );
}

export function channelGuestOutboxDue(
  storage: DurableObjectStorage,
  now: string,
  limit: number,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select()
      .from(channelGuestOutbox)
      .where(lte(channelGuestOutbox.next_attempt_at, now))
      .orderBy(asc(channelGuestOutbox.next_attempt_at))
      .limit(limit)
      .all(),
  );
}

export function channelGuestOutboxNext(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .select({ next: channelGuestOutbox.next_attempt_at })
      .from(channelGuestOutbox)
      .orderBy(asc(channelGuestOutbox.next_attempt_at))
      .limit(1)
      .get(),
  );
}

export function channelGuestOutboxReschedule(
  storage: DurableObjectStorage,
  deliveryId: string,
  attempts: number,
  nextAttemptAt: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .update(channelGuestOutbox)
      .set({ attempts, next_attempt_at: nextAttemptAt })
      .where(eq(channelGuestOutbox.delivery_id, deliveryId))
      .run(),
  );
}

export function channelGuestOutboxDelete(
  storage: DurableObjectStorage,
  deliveryId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .delete(channelGuestOutbox)
      .where(eq(channelGuestOutbox.delivery_id, deliveryId))
      .run(),
  );
}

export function channelGuestOutboxDeleteForGuest(
  storage: DurableObjectStorage,
  guestId: string,
  subscriptionId?: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db
      .delete(channelGuestOutbox)
      .where(
        subscriptionId
          ? and(
              eq(channelGuestOutbox.guest_id, guestId),
              eq(channelGuestOutbox.subscription_id, subscriptionId),
            )
          : eq(channelGuestOutbox.guest_id, guestId),
      )
      .run(),
  );
}

export function channelGuestOutboxCountForGuest(
  storage: DurableObjectStorage,
  guestId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(
    () =>
      db
        .select({ queued: count() })
        .from(channelGuestOutbox)
        .where(eq(channelGuestOutbox.guest_id, guestId))
        .get()?.queued ?? 0,
  );
}
