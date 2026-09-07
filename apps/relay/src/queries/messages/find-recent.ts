import { desc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

export function messagesFindRecent<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, limit: number) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db.select().from(messages).orderBy(desc(messages.sequence)).limit(limit),
    ),
  );
}
