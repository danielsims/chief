import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const channels = sqliteTable("channels", {
  conversation_id: text("conversation_id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("channel"),
  is_private: integer("is_private").notNull().default(0),
  archived: integer("archived").notNull().default(0),
  description: text("description"),
  created_by_kind: text("created_by_kind").notNull(),
  created_by_id: text("created_by_id").notNull(),
  version: integer("version").notNull().default(1),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
