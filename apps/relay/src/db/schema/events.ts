import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  sequence: integer("sequence").primaryKey(),
  event_id: text("event_id").notNull(),
  event_json: text("event_json").notNull(),
});
