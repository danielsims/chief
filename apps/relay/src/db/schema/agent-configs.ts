import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agentConfigs = sqliteTable("agent_configs", {
  agent_id: text("agent_id").primaryKey(),
  config_json: text("config_json").notNull(),
  updated_at: text("updated_at").notNull(),
});
