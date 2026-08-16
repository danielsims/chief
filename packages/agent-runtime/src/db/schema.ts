import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type {
  ChannelActorIdentity,
  ChannelAgentPermission,
  ChannelAuditAction,
  ChannelWorkstream,
} from "@chief/channel-api";

import type {
  ActionResolution,
  AnalyticsDataset,
  ChannelActor,
  InputRequest,
  SessionArtifact,
} from "../types.js";
import { schedules } from "./schedule-schema.js";

export { schedules } from "./schedule-schema.js";
export * from "./project-schema.js";

export const channels = sqliteTable(
  "channel",
  {
    organizationId: text("organization_id").notNull(),
    id: text().notNull(),
    protocol: text({ enum: ["nip29"] }).notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    topic: text().notNull().default(""),
    description: text().notNull(),
    agentIds: text("agent_ids", { mode: "json" }).$type<string[]>().notNull(),
    userIds: text("user_ids", { mode: "json" }).$type<string[]>().notNull(),
    visibility: text({ enum: ["public", "private"] })
      .notNull()
      .default("public"),
    kind: text({ enum: ["standard", "feature"] })
      .notNull()
      .default("standard"),
    lifecycle: text({ enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    archivedAt: integer("archived_at"),
    createdBy: text("created_by", {
      mode: "json",
    }).$type<ChannelActorIdentity>(),
    agentPermissions: text("agent_permissions", { mode: "json" }).$type<
      ChannelAgentPermission[]
    >(),
    workstream: text({ mode: "json" }).$type<ChannelWorkstream>(),
    operationKey: text("operation_key"),
    version: integer().notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    uniqueIndex("channel_organization_slug").on(
      table.organizationId,
      table.slug,
    ),
    uniqueIndex("channel_organization_operation").on(
      table.organizationId,
      table.operationKey,
    ),
  ],
);

export const channelAudit = sqliteTable(
  "audit",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    channelId: text("channel_id").notNull(),
    action: text().$type<ChannelAuditAction>().notNull(),
    actor: text({ mode: "json" }).$type<ChannelActorIdentity>().notNull(),
    detail: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    sequence: integer().notNull().default(1),
    previousHash: text("previous_hash"),
    hash: text(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("audit_channel_timeline").on(
      table.organizationId,
      table.channelId,
      table.createdAt,
    ),
  ],
);

export const channelEvents = sqliteTable(
  "post",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    channelId: text("channel_id").notNull(),
    protocol: text({ enum: ["nip29"] }).notNull(),
    kind: integer().notNull(),
    pubkey: text().notNull(),
    tags: text({ mode: "json" }).$type<string[][]>().notNull(),
    content: text().notNull(),
    parts: text({ mode: "json" }).$type<unknown[]>(),
    actor: text({ mode: "json" }).$type<ChannelActor>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("post_timeline").on(
      table.organizationId,
      table.channelId,
      table.createdAt,
    ),
  ],
);

export const sessions = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => sessions.id, {
      onDelete: "cascade",
    }),
    triggerId: text("trigger_id"),
    triggerContext: text("trigger_context", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    scheduleId: text("schedule_id").references(() => schedules.id, {
      onDelete: "cascade",
    }),
    kind: text({ enum: ["conversation", "task"] }).notNull(),
    visibility: text({ enum: ["user", "private"] }).notNull(),
    agent: text().notNull(),
    title: text().notNull().default(""),
    lastText: text("last_text").notNull().default(""),
    provider: text().notNull(),
    model: text(),
    providerState: text("provider_state", { mode: "json" }).$type<unknown>(),
    eveState: text("eve_state", { mode: "json" }).$type<unknown>(),
    status: text({
      enum: [
        "idle",
        "running",
        "waiting",
        "completed",
        "failed",
        "needs_approval",
      ],
    })
      .notNull()
      .default("idle"),
    scheduledFor: integer("scheduled_for"),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    attempt: integer().notNull().default(1),
    summary: text(),
    error: text(),
    artifacts: text({ mode: "json" }).$type<SessionArtifact[]>(),
    blockedTools: text("blocked_tools", { mode: "json" }).$type<string[]>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("session_organization_updated").on(
      table.organizationId,
      table.updatedAt,
    ),
    index("session_parent").on(table.parentId),
    index("session_schedule_started").on(table.scheduleId, table.startedAt),
    uniqueIndex("session_schedule_occurrence").on(
      table.scheduleId,
      table.scheduledFor,
    ),
    uniqueIndex("session_schedule_trigger").on(
      table.scheduleId,
      table.triggerId,
    ),
    uniqueIndex("session_one_active_per_schedule")
      .on(table.scheduleId)
      .where(sql`${table.status} IN ('running', 'waiting')`),
  ],
);

export const messages = sqliteTable(
  "message",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text({ enum: ["system", "user", "assistant"] }).notNull(),
    parts: text({ mode: "json" }).$type<unknown[]>().notNull(),
    metadata: text({ mode: "json" }).$type<unknown>(),
    position: integer().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("message_session_position").on(table.sessionId, table.position),
    index("message_organization_session").on(
      table.organizationId,
      table.sessionId,
    ),
    index("message_session_created").on(table.sessionId, table.createdAt),
  ],
);

export const browserRuns = sqliteTable(
  "browser",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    parentConversationId: text("parent_conversation_id"),
    threadRootId: text("thread_root_id"),
    anchorMessageId: text("anchor_message_id"),
    url: text().notNull(),
    title: text().notNull().default(""),
    status: text({ enum: ["active", "complete"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("browser_organization_conversation").on(
      table.organizationId,
      table.conversationId,
      table.createdAt,
    ),
    index("browser_active").on(table.organizationId, table.status),
  ],
);

export const events = sqliteTable(
  "event",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    type: text().notNull(),
    level: text({ enum: ["debug", "info", "warn", "error"] }).notNull(),
    data: text({ mode: "json" }).$type<unknown>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("event_session_position").on(table.sessionId, table.position),
    index("event_organization_session").on(
      table.organizationId,
      table.sessionId,
    ),
    index("event_session_created").on(table.sessionId, table.createdAt),
  ],
);

export const prospects = sqliteTable(
  "prospect",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text().notNull(),
    company: text(),
    source: text().notNull(),
    sourceUrl: text("source_url"),
    summary: text().notNull(),
    relevance: text({ enum: ["high", "medium", "low"] }).notNull(),
    status: text({
      enum: ["new", "researching", "contacted", "dismissed"],
    }).notNull(),
    foundAt: integer("found_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("prospect_organization_found").on(
      table.organizationId,
      table.foundAt,
    ),
  ],
);

export const trends = sqliteTable(
  "trend",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    title: text().notNull(),
    source: text().notNull(),
    sourceUrl: text("source_url"),
    summary: text().notNull(),
    signal: text({ enum: ["high", "medium", "low"] }).notNull(),
    status: text({ enum: ["new", "watching", "acted", "dismissed"] }).notNull(),
    foundAt: integer("found_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("trend_organization_found").on(table.organizationId, table.foundAt),
  ],
);

export const analyticsDatasets = sqliteTable(
  "dataset",
  {
    organizationId: text("organization_id").notNull(),
    provider: text().notNull(),
    key: text().notNull(),
    sourceId: text("source_id").notNull().default(""),
    data: text({ mode: "json" }).$type<AnalyticsDataset>().notNull(),
    capturedAt: integer("captured_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.provider,
        table.key,
        table.sourceId,
      ],
    }),
    index("dataset_organization_captured").on(
      table.organizationId,
      table.capturedAt,
    ),
  ],
);

export const contentDrafts = sqliteTable(
  "content",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    agentId: text("agent_id").notNull(),
    title: text().notNull(),
    body: text().notNull(),
    platform: text().notNull(),
    fileId: text("file_id"),
    status: text({
      enum: ["draft", "approved", "scheduled", "published"],
    }).notNull(),
    scheduledFor: integer("scheduled_for"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("content_organization_schedule").on(
      table.organizationId,
      table.scheduledFor,
    ),
  ],
);

export const workspaceFiles = sqliteTable(
  "file",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text().notNull(),
    path: text().notNull(),
    mimeType: text("mime_type").notNull(),
    kind: text({ enum: ["document", "email"] }).notNull(),
    provider: text({ enum: ["local"] })
      .notNull()
      .default("local"),
    currentVersionId: text("current_version_id").notNull(),
    createdBy: text("created_by", { enum: ["agent", "user"] }).notNull(),
    sourceAgentId: text("source_agent_id"),
    sourceSessionId: text("source_session_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("file_organization_path").on(table.organizationId, table.path),
    index("file_organization_updated").on(
      table.organizationId,
      table.updatedAt,
    ),
  ],
);

export const workspaceFileVersions = sqliteTable(
  "version",
  {
    id: text().primaryKey(),
    fileId: text("file_id")
      .notNull()
      .references(() => workspaceFiles.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull(),
    content: text().notNull(),
    size: integer().notNull(),
    createdBy: text("created_by", { enum: ["agent", "user"] }).notNull(),
    sourceAgentId: text("source_agent_id"),
    sourceSessionId: text("source_session_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("version_file_created").on(table.fileId, table.createdAt)],
);

export const campaigns = sqliteTable(
  "campaign",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text().notNull(),
    provider: text().notNull(),
    objective: text(),
    status: text({
      enum: ["draft", "in_review", "live", "paused", "completed"],
    }).notNull(),
    currency: text().notNull().default("USD"),
    budget: real(),
    spend: real(),
    revenue: real(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("campaign_organization_updated").on(
      table.organizationId,
      table.updatedAt,
    ),
  ],
);

export const agentPreferences = sqliteTable(
  "preference",
  {
    organizationId: text("organization_id").notNull(),
    agentId: text("agent_id").notNull(),
    enabled: integer({ mode: "boolean" }).notNull(),
    driver: text({ enum: ["claude", "codex", "opencode", "remote"] }),
    model: text(),
    approvals: text({ enum: ["auto", "ask"] }),
    capabilities: text({ mode: "json" }).$type<string[]>(),
    integrations: text({ mode: "json" }).$type<string[]>(),
    toolPermissions: text("tool_permissions", { mode: "json" }).$type<
      string[]
    >(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.agentId] })],
);

export const actions = sqliteTable(
  "action",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    agentId: text("agent_id").notNull(),
    title: text().notNull(),
    reason: text().notNull(),
    sourceId: text("source_id"),
    threadRootId: text("thread_root_id"),
    request: text({ mode: "json" }).$type<InputRequest>(),
    resolution: text({ mode: "json" }).$type<ActionResolution>(),
    status: text({ enum: ["open", "resolved", "dismissed"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("action_organization_status").on(table.organizationId, table.status),
  ],
);
