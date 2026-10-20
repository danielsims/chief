import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const boardItems = sqliteTable("board_items", {
  item_id: text("item_id").primaryKey(),
  item_json: text("item_json").notNull(),
  updated_at: integer("updated_at").notNull(),
});
