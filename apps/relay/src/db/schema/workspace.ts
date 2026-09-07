import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspace = sqliteTable("workspace", {
  singleton: integer("singleton").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  name: text("name").notNull(),
  created_at: text("created_at").notNull(),
  created_by_user_id: text("created_by_user_id").notNull(),
  snapshot_json: text("snapshot_json"),
});
