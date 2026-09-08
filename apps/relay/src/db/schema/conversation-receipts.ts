import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// Conversation and agent authorities have independent SQLite databases.
export const conversationReceipts = sqliteTable("receipts", {
  command_id: text("command_id").primaryKey(),
  result_json: text("result_json").notNull(),
});
