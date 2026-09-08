import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const prospects = sqliteTable("prospects", {
  prospect_id: text("prospect_id").primaryKey(),
  prospect_json: text("prospect_json").notNull(),
  relevance: text("relevance").notNull(),
  found_at: text("found_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
