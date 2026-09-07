import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  project_id: text("project_id").primaryKey(),
  agent_id: text("agent_id"),
  name: text("name").notNull(),
  description: text("description"),
  repository_kind: text("repository_kind").notNull(),
  provider_id: text("provider_id").notNull(),
  canonical_remote_url: text("canonical_remote_url"),
  repository_web_url: text("repository_web_url"),
  repository_files_json: text("repository_files_json"),
  default_branch: text("default_branch").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
