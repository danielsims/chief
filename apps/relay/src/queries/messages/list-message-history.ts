import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

export function listMessageHistory<Row extends Record<string, SqlStorageValue>>(
  storage: DurableObjectStorage,
  threadRootId: string | undefined,
  limit: number,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.deleted, 0),
            sql`trim(${messages.body}) <> ''`,
            threadRootId
              ? or(
                  eq(messages.message_id, threadRootId),
                  eq(messages.thread_root_id, threadRootId),
                )
              : isNull(messages.thread_root_id),
          ),
        )
        .orderBy(desc(messages.sequence))
        .limit(limit),
    ),
  );
}
