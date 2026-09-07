import { and, asc, eq, gt } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

export function messagesFindReplies<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(
  storage: DurableObjectStorage,
  {
    threadRootId,
    sequence,
    limit,
  }: { threadRootId: string; sequence: number; limit: number },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.thread_root_id, threadRootId),
            gt(messages.sequence, sequence),
          ),
        )
        .orderBy(asc(messages.sequence))
        .limit(limit),
    ),
  );
}
