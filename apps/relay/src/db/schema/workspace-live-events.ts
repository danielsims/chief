import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceLiveEvents = sqliteTable("workspace_live_events", {
  sequence: integer("sequence").primaryKey(),
  conversation_id: text("conversation_id").notNull(),
  event_json: text("event_json").notNull(),
});
