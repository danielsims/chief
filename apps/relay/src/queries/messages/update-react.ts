import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { messages } from "../../db/schema/messages";

export function messagesUpdateReact(
  storage: DurableObjectStorage,
  reactionsJson: string,
  messageId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(messages)
        .set({ reactions_json: reactionsJson })
        .where(eq(messages.message_id, messageId)),
    ),
  );
}
