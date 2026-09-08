import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const counters = sqliteTable("counters", {
  name: text("name").primaryKey(),
  value: integer("value").notNull(),
});
