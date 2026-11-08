import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectIcons = sqliteTable("project_icons", {
  project_id: text("project_id").primaryKey(),
  data_url: text("data_url").notNull(),
  updated_at: text("updated_at").notNull(),
});
