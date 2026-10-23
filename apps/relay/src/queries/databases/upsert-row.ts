import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { databaseRows } from "../../db/schema/databases";

export function databasesUpsertRow(
  storage: DurableObjectStorage,
  {
    rowId,
    databaseId,
    rowJson,
    updatedAt,
  }: { rowId: string; databaseId: string; rowJson: string; updatedAt: number },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(databaseRows)
        .values({
          row_id: rowId,
          database_id: databaseId,
          row_json: rowJson,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [databaseRows.row_id],
          set: {
            row_json: sql`excluded.row_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
