import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceLiveCounters = sqliteTable("workspace_live_counters", {
  name: text("name").primaryKey(),
  value: integer("value").notNull(),
});
