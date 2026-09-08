import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

export function messagesUpdateDelete(
  storage: DurableObjectStorage,
  body: string,
  messageId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(messages)
        .set({ body: body, edited: 0, deleted: 1 })
        .where(eq(messages.message_id, messageId)),
    ),
  );
}
