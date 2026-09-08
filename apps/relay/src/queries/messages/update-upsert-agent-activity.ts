import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

export function messagesUpdateUpsertAgentActivity(
  storage: DurableObjectStorage,
  componentsJson: string,
  messageId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(messages)
        .set({ components_json: componentsJson })
        .where(eq(messages.message_id, messageId)),
    ),
  );
}
