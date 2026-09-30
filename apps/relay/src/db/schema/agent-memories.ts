import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agentMemories = sqliteTable("agent_memories", {
  memory_id: integer("memory_id").primaryKey({ autoIncrement: true }),
  agent_id: text("agent_id").notNull(),
  scope_key: text("scope_key").notNull(),
  text: text("text").notNull(),
  created_at: text("created_at").notNull(),
});
