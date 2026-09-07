import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceDirectoryV2 = sqliteTable("workspace_directory_v2", {
  workspace_id: text("workspace_id").primaryKey(),
  operation_id: text("operation_id").notNull(),
  name: text("name").notNull(),
  website: text("website").notNull().default(""),
  create_command_json: text("create_command_json"),
  created_at: text("created_at").notNull(),
  active: integer("active").notNull().default(1),
});
