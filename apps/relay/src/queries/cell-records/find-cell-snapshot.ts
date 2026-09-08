import { asc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { cellRecords } from "../../db/schema/cell-records";

export function cellRecordsFindCellSnapshot<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ key: cellRecords.key, value_json: cellRecords.value_json })
        .from(cellRecords)
        .orderBy(asc(cellRecords.key))
        .limit(1000),
    ),
  );
}
