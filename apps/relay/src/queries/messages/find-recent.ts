import { desc, isNotNull, isNull } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

/**
 * The newest top-level messages and, separately, the newest thread replies,
 * newest first. A long agent run fills its thread with activity, so one shared
 * window would push the conversation's own messages out of the page.
 */
export function messagesFindRecent<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, limit: number) {
  const db = relayDatabase(storage);
  const newest = (threaded: boolean) =>
    db.all<Row>(
      db
        .select()
        .from(messages)
        .where(
          threaded
            ? isNotNull(messages.thread_root_id)
            : isNull(messages.thread_root_id),
        )
        .orderBy(desc(messages.sequence))
        .limit(limit),
    );
  return executeDatabaseQuery(() =>
    [...newest(false), ...newest(true)].sort(
      (a, b) => Number(b.sequence) - Number(a.sequence),
    ),
  );
}
