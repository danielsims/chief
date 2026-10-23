import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { databaseRows } from "../../db/schema/databases";

export function databasesFindListRows<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, databaseId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ row_json: databaseRows.row_json })
        .from(databaseRows)
        .where(eq(databaseRows.database_id, databaseId)),
    ),
  );
}
