import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const brandProfile = sqliteTable("brand_profile", {
  singleton: integer("singleton").primaryKey(),
  markdown: text("markdown").notNull(),
  source_urls_json: text("source_urls_json").notNull(),
  version: integer("version").notNull(),
  author_agent_id: text("author_agent_id").notNull(),
  updated_at: text("updated_at").notNull(),
});
