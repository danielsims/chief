import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const externalAgentOutbox = sqliteTable(
  "external_agent_outbox",
  {
    agent_id: text("agent_id").notNull(),
    delivery_id: text("delivery_id").notNull(),
    payload_hash: text("payload_hash").notNull(),
    payload_json: text("payload_json").notNull(),
    delivery_generation: integer("delivery_generation").notNull().default(1),
    capability_hash: text("capability_hash").notNull(),
    conversation_id: text("conversation_id").notNull(),
    thread_root_id: text("thread_root_id"),
    session_address: text("session_address").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    next_attempt_at: text("next_attempt_at").notNull(),
    delivering_since: text("delivering_since"),
    session_id: text("session_id"),
    last_error: text("last_error"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.agent_id, table.delivery_id] })],
);
