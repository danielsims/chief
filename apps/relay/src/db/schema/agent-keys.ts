import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agentKeys = sqliteTable("agent_keys", {
  agent_id: text("agent_id").primaryKey(),
  pubkey: text("pubkey").notNull(),
  created_at: text("created_at").notNull(),
});
