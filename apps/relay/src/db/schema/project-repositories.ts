import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectRepositories = sqliteTable("project_repositories", {
  repository_id: text("repository_id").primaryKey(),
  project_id: text("project_id").notNull(),
  provider_id: text("provider_id").notNull(),
  canonical_remote_url: text("canonical_remote_url").notNull(),
  provider_repository_id: text("provider_repository_id").notNull(),
  created_at: text("created_at").notNull(),
});
