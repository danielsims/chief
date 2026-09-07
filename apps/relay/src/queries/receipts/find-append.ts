import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { conversationReceipts } from "../../db/schema/conversation-receipts";

export function receiptsFindAppend<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, commandId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ result_json: conversationReceipts.result_json })
        .from(conversationReceipts)
        .where(eq(conversationReceipts.command_id, commandId)),
    ),
  );
}
