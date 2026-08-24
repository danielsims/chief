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
  ProjectGrantConstraint,
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

export const projectGrants = sqliteTable(
  "project_grant",
  {
    organizationId: text("organization_id").notNull(),
    id: text().notNull(),
    projectId: text("project_id").notNull(),
    principalType: text("principal_type", {
      enum: ["user", "agent", "role"],
    }).notNull(),
    principalId: text("principal_id").notNull(),
    capability: text({
      enum: ["view", "checkout", "commit", "publish", "review", "administer"],
    }).notNull(),
    constraintJson: text("constraint_json", {
      mode: "json",
    }).$type<ProjectGrantConstraint>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    uniqueIndex("project_grant_principal_capability").on(
      table.organizationId,
      table.projectId,
      table.principalType,
      table.principalId,
      table.capability,
    ),
    index("project_grant_principal").on(
      table.organizationId,
      table.principalId,
    ),
    index("project_grant_project").on(table.organizationId, table.projectId),
  ],
);

export const providerConnections = sqliteTable(
  "provider_connection",
  {
    organizationId: text("organization_id").notNull(),
    id: text().notNull(),
    providerId: text("provider_id", {
      enum: ["github", "gitlab", "bitbucket"],
    }).notNull(),
    installationId: text("installation_id"),
    accountLabel: text("account_label"),
    secretReference: text("secret_reference"),
    status: text({
      enum: ["active", "expired", "revoked", "error"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    uniqueIndex("provider_connection_installation").on(
      table.organizationId,
      table.installationId,
    ),
    index("provider_connection_status").on(table.organizationId, table.status),
  ],
);

export const projectProviderLinks = sqliteTable(
  "project_provider_link",
  {
    organizationId: text("organization_id").notNull(),
    id: text().notNull(),
    projectId: text("project_id").notNull(),
    connectionId: text("connection_id").notNull(),
    providerRepositoryId: text("provider_repository_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    uniqueIndex("project_provider_link_project_connection").on(
      table.organizationId,
      table.projectId,
      table.connectionId,
    ),
    index("project_provider_link_connection").on(
      table.organizationId,
      table.connectionId,
    ),
  ],
);

export const projectOperations = sqliteTable(
  "project_operation",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id"),
    principalType: text("principal_type", {
      enum: ["user", "agent", "role"],
    }),
    principalId: text("principal_id"),
    agentId: text("agent_id"),
    checkoutId: text("checkout_id"),
    branch: text(),
    operation: text({
      enum: [
        "attach",
        "clone",
        "list",
        "inspect",
        "browse",
        "inspect_commit",
        "compare",
        "checkout",
        "commit",
        "publish",
        "discard",
        "release",
        "remove",
        "grant",
        "denied",
      ],
    }).notNull(),
    result: text({ enum: ["success", "denied", "failed"] }).notNull(),
    commitHash: text("commit_hash"),
    correlationId: text("correlation_id"),
    message: text(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("project_operation_timeline").on(
      table.organizationId,
      table.projectId,
      table.createdAt,
    ),
    index("project_operation_principal").on(
      table.organizationId,
      table.principalId,
      table.createdAt,
    ),
  ],
);

export const projectAccessRequests = sqliteTable(
  "project_access_request",
  {
    id: text().notNull(),
    organizationId: text("organization_id").notNull(),
    projectId: text("project_id").notNull(),
    agentId: text("agent_id").notNull(),
    capability: text({
      enum: ["view", "checkout", "commit", "publish", "review", "administer"],
    }).notNull(),
    status: text({ enum: ["pending", "approved", "denied"] }).notNull(),
    requestedAt: integer("requested_at").notNull(),
    resolvedAt: integer("resolved_at"),
    resolvedBy: text("resolved_by"),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    index("project_access_request_pending").on(
      table.organizationId,
      table.status,
      table.requestedAt,
    ),
    index("project_access_request_project").on(
      table.organizationId,
      table.projectId,
    ),
  ],
);
