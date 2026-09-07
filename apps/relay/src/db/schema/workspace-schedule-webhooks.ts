import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceScheduleWebhooks = sqliteTable(
  "workspace_schedule_webhooks",
  {
    id: text("id").primaryKey(),
    document_json: text("document_json").notNull(),
    secret: text("secret").notNull(),
  },
);
