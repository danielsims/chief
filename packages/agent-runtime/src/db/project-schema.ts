import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type {
  ProjectCheckoutRecord,
  ProjectRepositoryBindingRecord,
} from "../project-types.js";

export const projects = sqliteTable(
  "project",
  {
    organizationId: text("organization_id").notNull(),
    id: text().notNull(),
    name: text().notNull(),
    description: text(),
    repositoryKind: text("repository_kind", {
      enum: ["attached", "cloned"],
    }).notNull(),
    providerId: text("provider_id", {
      enum: ["local", "generic-git", "github", "gitlab", "bitbucket"],
    }).notNull(),
    canonicalRemoteUrl: text("canonical_remote_url"),
    repositoryWebUrl: text("repository_web_url"),
    defaultBranch: text("default_branch").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    uniqueIndex("project_organization_remote").on(
      table.organizationId,
      table.canonicalRemoteUrl,
    ),
    index("project_organization_updated").on(
      table.organizationId,
      table.updatedAt,
    ),
  ],
);

export const projectRepositoryBindings = sqliteTable(
  "binding",
  {
    organizationId: text("organization_id").notNull(),
    id: text().notNull(),
    projectId: text("project_id").notNull(),
    runtimeId: text("runtime_id").notNull(),
    kind: text({ enum: ["attached", "materialized"] })
      .$type<ProjectRepositoryBindingRecord["kind"]>()
      .notNull(),
    repositoryPath: text("repository_path").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    uniqueIndex("project_binding_runtime_project").on(
      table.organizationId,
      table.runtimeId,
      table.projectId,
    ),
    uniqueIndex("project_binding_runtime_path").on(
      table.organizationId,
      table.runtimeId,
      table.repositoryPath,
    ),
  ],
);

export const projectCheckouts = sqliteTable(
  "checkout",
  {
    organizationId: text("organization_id").notNull(),
    id: text().notNull(),
    projectId: text("project_id").notNull(),
    runtimeId: text("runtime_id").notNull(),
    agentId: text("agent_id").notNull(),
    agentIdentity: text("agent_identity").notNull(),
    sessionId: text("session_id"),
    strategy: text({ enum: ["worktree", "clone"] }).notNull(),
    path: text().notNull(),
    branch: text().notNull(),
    baseRef: text("base_ref").notNull(),
    status: text({ enum: ["active", "released"] })
      .$type<ProjectCheckoutRecord["status"]>()
      .notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    uniqueIndex("project_checkout_organization_path").on(
      table.organizationId,
      table.runtimeId,
      table.path,
    ),
    index("project_checkout_project_status").on(
      table.organizationId,
      table.projectId,
      table.status,
    ),
    index("project_checkout_agent").on(
      table.organizationId,
      table.agentId,
      table.updatedAt,
    ),
  ],
);
