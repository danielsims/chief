import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const externalAgentDefinitions = sqliteTable(
  "external_agent_definitions",
  {
    agent_id: text("agent_id").primaryKey(),
    project_id: text("project_id").notNull(),
    repository_id: text("repository_id").notNull(),
    provider_id: text("provider_id").notNull(),
    repository_identity: text("repository_identity").notNull(),
    path: text("path").notNull(),
    requested_ref: text("requested_ref").notNull(),
    verification_status: text("verification_status")
      .notNull()
      .default("unresolved"),
    resolved_commit_sha: text("resolved_commit_sha"),
    content_digest: text("content_digest"),
  },
);
