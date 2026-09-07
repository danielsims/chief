import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const missions = sqliteTable("missions", {
  mission_id: text("mission_id").primaryKey(),
  document_json: text("document_json").notNull(),
});
