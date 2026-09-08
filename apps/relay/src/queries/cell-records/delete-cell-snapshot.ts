import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { cellRecords } from "../../db/schema/cell-records";

export function cellRecordsDeleteCellSnapshot(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() => db.run(db.delete(cellRecords)));
}
