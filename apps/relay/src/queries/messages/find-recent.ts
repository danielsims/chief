import { and, desc, lt, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

/**
 * The newest conversational messages and, separately, the newest agent
 * activity rows (an agent message with no text), newest first. A long run
 * writes a row per tool call, so one shared window would push the
 * conversation's messages out. A reply always follows its root, so every
 * thread in the window arrives with all of its replies.
 */
export function messagesFindRecent<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, limit: number, before?: number) {
  const db = relayDatabase(storage);
  // Kept literal so SQLite can match messages_conversational_idx.
  const conversational = sql`(${messages.author_kind} <> 'agent' OR ${messages.body} <> '')`;
  const newest = (where: typeof conversational) =>
    db.all<Row>(
      db
        .select()
        .from(messages)
        .where(and(where, before ? lt(messages.sequence, before) : undefined))
        .orderBy(desc(messages.sequence))
        .limit(limit),
    );
  return executeDatabaseQuery(() =>
    [...newest(conversational), ...newest(sql`NOT ${conversational}`)].sort(
      (a, b) => Number(b.sequence) - Number(a.sequence),
    ),
  );
}
