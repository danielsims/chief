import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { cellRecords } from "../../db/schema/cell-records";

export function cellRecordsInsertPutRecord(
  storage: DurableObjectStorage,
  {
    key,
    valueJson,
    updatedAt,
  }: { key: string; valueJson: string; updatedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(cellRecords)
        .values({ key: key, value_json: valueJson, updated_at: updatedAt })
        .onConflictDoUpdate({
          target: [cellRecords.key],
          set: {
            value_json: sql`excluded.value_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
