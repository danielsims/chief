import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceLiveCounters } from "../../db/schema/workspace-live-counters";

export function workspaceLiveCountersFindCurrentSequence<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ value: workspaceLiveCounters.value })
        .from(workspaceLiveCounters)
        .where(eq(workspaceLiveCounters.name, "sequence")),
    ),
  );
}
