import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cellRecords = sqliteTable("cell_records", {
  key: text("key").primaryKey(),
  value_json: text("value_json").notNull(),
  updated_at: text("updated_at").notNull(),
});
