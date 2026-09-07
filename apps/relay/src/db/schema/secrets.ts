import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const secrets = sqliteTable("secrets", {
  key: text("key").primaryKey(),
  value_json: text("value_json").notNull(),
  updated_at: text("updated_at").notNull(),
});
