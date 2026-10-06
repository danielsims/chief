import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { conversationActivity } from "../../db/schema/conversation-activity";

export function conversationActivityUpsertPublish(
  storage: DurableObjectStorage,
  {
    conversationId,
    lastMessageAt,
  }: { conversationId: string; lastMessageAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(conversationActivity)
        .values({
          conversation_id: conversationId,
          last_message_at: lastMessageAt,
        })
        .onConflictDoUpdate({
          target: conversationActivity.conversation_id,
          set: {
            last_message_at: sql`max(${conversationActivity.last_message_at}, excluded.last_message_at)`,
          },
        }),
    ),
  );
}
