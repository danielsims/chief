import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const externalAgentInboundReceipts = sqliteTable(
  "external_agent_inbound_receipts",
  {
    agent_id: text("agent_id").notNull(),
    delivery_id: text("delivery_id").notNull(),
    payload_hash: text("payload_hash").notNull(),
    message_id: text("message_id").notNull(),
    status: text("status").notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.agent_id, table.delivery_id] })],
);
