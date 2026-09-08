import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceScheduleRuns = sqliteTable("workspace_schedule_runs", {
  id: text("id").primaryKey(),
  schedule_id: text("schedule_id").notNull(),
  state: text("state").notNull(),
  next_check_at: integer("next_check_at"),
  created_at: integer("created_at").notNull(),
  document_json: text("document_json").notNull(),
  principal_json: text("principal_json").notNull(),
});
