import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { conversationReceipts } from "../../db/schema/conversation-receipts";

export function receiptsInsertAppend(
  storage: DurableObjectStorage,
  commandId: string,
  resultJson: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(conversationReceipts)
        .values({ command_id: commandId, result_json: resultJson }),
    ),
  );
}
