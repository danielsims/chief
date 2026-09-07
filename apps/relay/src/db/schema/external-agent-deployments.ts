import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const externalAgentDeployments = sqliteTable(
  "external_agent_deployments",
  {
    agent_id: text("agent_id").primaryKey(),
    status: text("status").notNull(),
    resolved_commit_sha: text("resolved_commit_sha"),
    attested_at: text("attested_at"),
  },
);
