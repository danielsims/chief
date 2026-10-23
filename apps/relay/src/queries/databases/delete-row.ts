import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { databaseRows } from "../../db/schema/databases";

export function databasesDeleteRow(
  storage: DurableObjectStorage,
  databaseId: string,
  rowId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(databaseRows)
        .where(
          and(
            eq(databaseRows.database_id, databaseId),
            eq(databaseRows.row_id, rowId),
          ),
        ),
    ),
  );
}
