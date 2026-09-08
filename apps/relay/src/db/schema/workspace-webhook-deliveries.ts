import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const workspaceWebhookDeliveries = sqliteTable(
  "workspace_webhook_deliveries",
  {
    webhook_id: text("webhook_id").notNull(),
    delivery_id: text("delivery_id").notNull(),
    body_hash: text("body_hash").notNull(),
    run_id: text("run_id").notNull(),
    received_at: integer("received_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.webhook_id, table.delivery_id] })],
);
