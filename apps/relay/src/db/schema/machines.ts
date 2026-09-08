import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const machines = sqliteTable("machines", {
  machine_id: text("machine_id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  endpoint: text("endpoint"),
  capabilities_json: text("capabilities_json").notNull(),
  agent_ids_json: text("agent_ids_json").notNull(),
  last_seen_at: text("last_seen_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
