import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** When each conversation last received a message, for recency ordering. */
export const conversationActivity = sqliteTable("conversation_activity", {
  conversation_id: text("conversation_id").primaryKey(),
  last_message_at: text("last_message_at").notNull(),
});
