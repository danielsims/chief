import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceFiles = sqliteTable("workspace_files", {
  file_id: text("file_id").primaryKey(),
  path: text("path").notNull(),
  title: text("title").notNull(),
  mime_type: text("mime_type").notNull(),
  content: text("content").notNull(),
  conversation_id: text("conversation_id").notNull(),
  author_agent_id: text("author_agent_id").notNull(),
  version: integer("version").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  asset_json: text("asset_json"),
});
