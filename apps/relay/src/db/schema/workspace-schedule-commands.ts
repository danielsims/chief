import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceScheduleCommands = sqliteTable(
  "workspace_schedule_commands",
  {
    command_id: text("command_id").primaryKey(),
    schedule_id: text("schedule_id").notNull(),
    action: text("action").notNull(),
  },
);
