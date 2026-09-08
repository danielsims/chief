import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { receipts } from "../../db/schema/receipts";

export function receiptsFindEnqueue<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, commandId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ job_json: receipts.job_json })
        .from(receipts)
        .where(eq(receipts.command_id, commandId)),
    ),
  );
}
