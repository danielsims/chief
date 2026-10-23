import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The latest few deliveries to each automation webhook, run or not. */
export const workspaceWebhookEvents = sqliteTable("workspace_webhook_events", {
  webhook_id: text("webhook_id").notNull(),
  received_at: integer("received_at").notNull(),
  input_json: text("input_json").notNull(),
});
