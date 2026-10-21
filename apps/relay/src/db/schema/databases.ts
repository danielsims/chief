import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const databases = sqliteTable("databases", {
  database_id: text("database_id").primaryKey(),
  conversation_id: text("conversation_id").notNull(),
  database_json: text("database_json").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const databaseRows = sqliteTable("database_rows", {
  row_id: text("row_id").primaryKey(),
  database_id: text("database_id").notNull(),
  row_json: text("row_json").notNull(),
  updated_at: integer("updated_at").notNull(),
});
