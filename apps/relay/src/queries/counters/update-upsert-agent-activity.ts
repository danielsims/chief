import { eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { counters } from "../../db/schema/counters";

export function countersUpdateUpsertAgentActivity<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .update(counters)
        .set({ value: sql`${counters.value} + ${1}` })
        .where(eq(counters.name, "sequence"))
        .returning({ value: counters.value }),
    ),
  );
}
