import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const boardLanes = sqliteTable("board_lanes", {
  board_id: text("board_id").primaryKey(),
  lanes_json: text("lanes_json").notNull(),
  updated_at: integer("updated_at").notNull(),
});
