import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { receipts } from "../../db/schema/receipts";

export function receiptsInsertEnqueue(
  storage: DurableObjectStorage,
  commandId: string,
  jobJson: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(receipts).values({ command_id: commandId, job_json: jobJson }),
    ),
  );
}
