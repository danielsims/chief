import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { receipts } from "../../db/schema/receipts";

export function receiptsUpdateUpdateReceipt(
  storage: DurableObjectStorage,
  jobJson: string,
  commandId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(receipts)
        .set({ job_json: jobJson })
        .where(eq(receipts.command_id, commandId)),
    ),
  );
}
