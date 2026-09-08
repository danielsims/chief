import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const externalAgentRuntimes = sqliteTable("external_agent_runtimes", {
  agent_id: text("agent_id").primaryKey(),
  endpoint_url: text("endpoint_url").notNull(),
  connection_status: text("connection_status")
    .notNull()
    .default("pending_setup"),
  token_hash: text("token_hash").notNull(),
  token_secret_ref: text("token_secret_ref").notNull(),
  delivery_signing_key_id: text("delivery_signing_key_id")
    .notNull()
    .default(""),
  delivery_signing_secret_ref: text("delivery_signing_secret_ref")
    .notNull()
    .default(""),
  registration_command_id: text("registration_command_id").notNull(),
  registration_payload_hash: text("registration_payload_hash").notNull(),
  registration_result_json: text("registration_result_json"),
  replaces_native: integer("replaces_native").notNull().default(0),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
