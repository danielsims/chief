import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const log = sqliteTable("log", {
  sequence: integer("sequence").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  log_id: text("log_id").notNull(),
  correlation_id: text("correlation_id").notNull(),
  type: text("type").notNull(),
  operation: text("operation").notNull(),
  deployment: text("deployment"),
  agent_id: text("agent_id"),
  conversation_id: text("conversation_id"),
  message: text("message").notNull(),
  payload_json: text("payload_json"),
  created_at: text("created_at").notNull(),
});
