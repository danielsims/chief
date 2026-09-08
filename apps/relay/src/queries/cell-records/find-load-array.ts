import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { cellRecords } from "../../db/schema/cell-records";

export function cellRecordsFindLoadArray<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, key: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ value_json: cellRecords.value_json })
        .from(cellRecords)
        .where(eq(cellRecords.key, key)),
    ),
  );
}
