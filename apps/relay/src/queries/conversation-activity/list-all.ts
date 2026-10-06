import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { conversationActivity } from "../../db/schema/conversation-activity";

export function conversationActivityListAll(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<{ conversation_id: string; last_message_at: string }>(
      db.select().from(conversationActivity),
    ),
  );
}
