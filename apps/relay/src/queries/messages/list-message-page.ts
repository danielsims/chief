import { and, asc, gt, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

export function listMessagePage<Row extends Record<string, SqlStorageValue>>(
  storage: DurableObjectStorage,
  { after, limit, pattern }: { after: number; limit: number; pattern?: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(messages)
        .where(
          and(
            gt(messages.sequence, after),
            pattern
              ? sql`${messages.body} LIKE ${pattern} ESCAPE '\\' COLLATE NOCASE`
              : undefined,
          ),
        )
        .orderBy(asc(messages.sequence))
        .limit(limit),
    ),
  );
}
