import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectStoreMigrations = sqliteTable("project_store_migrations", {
  migration_id: text("migration_id").primaryKey(),
  completed_at: text("completed_at").notNull(),
});
