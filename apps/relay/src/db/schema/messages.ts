import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable("messages", {
  message_id: text("message_id").primaryKey(),
  command_id: text("command_id").notNull(),
  sequence: integer("sequence").notNull(),
  workspace_id: text("workspace_id").notNull(),
  conversation_id: text("conversation_id").notNull(),
  thread_root_id: text("thread_root_id"),
  author_kind: text("author_kind").notNull(),
  author_id: text("author_id").notNull(),
  body: text("body").notNull(),
  mentions_json: text("mentions_json").notNull().default("[]"),
  components_json: text("components_json").notNull(),
  reactions_json: text("reactions_json").notNull().default("[]"),
  edited: integer("edited").notNull().default(0),
  deleted: integer("deleted").notNull().default(0),
  created_at: text("created_at").notNull(),
});
