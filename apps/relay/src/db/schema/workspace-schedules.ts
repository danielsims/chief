import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceSchedules = sqliteTable("workspace_schedules", {
  id: text("id").primaryKey(),
  document_json: text("document_json").notNull(),
  next_at: integer("next_at"),
});
