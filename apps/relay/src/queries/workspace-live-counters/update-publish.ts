import { eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceLiveCounters } from "../../db/schema/workspace-live-counters";

export function workspaceLiveCountersUpdatePublish<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .update(workspaceLiveCounters)
        .set({ value: sql`${workspaceLiveCounters.value} + ${1}` })
        .where(eq(workspaceLiveCounters.name, "sequence"))
        .returning({ value: workspaceLiveCounters.value }),
    ),
  );
}
