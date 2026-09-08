import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const deviceActiveWorkspaces = sqliteTable("device_active_workspaces", {
  device_pubkey: text("device_pubkey").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  updated_at: text("updated_at").notNull(),
});
