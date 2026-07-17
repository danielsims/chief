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

export const chats = sqliteTable(
  "chats",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    title: text().notNull(),
    lastText: text("last_text").notNull().default(""),
    driver: text({ enum: ["claude", "codex", "opencode"] }).notNull(),
    model: text(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("chats_workspace_updated").on(table.workspaceId, table.updatedAt),
  ],
);

export const chatEvents = sqliteTable(
  "chat_events",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    eventJson: text("event_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.position] })],
);

export const prospects = sqliteTable(
  "prospects",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
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
    index("prospects_workspace_found").on(table.workspaceId, table.foundAt),
  ],
);

export const trends = sqliteTable(
  "trends",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
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
    index("trends_workspace_found").on(table.workspaceId, table.foundAt),
  ],
);

export const contentDrafts = sqliteTable(
  "content_drafts",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
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
    index("drafts_workspace_schedule").on(
      table.workspaceId,
      table.scheduledFor,
    ),
  ],
);

export const workspaceFiles = sqliteTable(
  "workspace_files",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
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
    sourceRunId: text("source_run_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_files_workspace_path").on(
      table.workspaceId,
      table.path,
    ),
    index("workspace_files_workspace_updated").on(
      table.workspaceId,
      table.updatedAt,
    ),
  ],
);

export const workspaceFileVersions = sqliteTable(
  "workspace_file_versions",
  {
    id: text().primaryKey(),
    fileId: text("file_id")
      .notNull()
      .references(() => workspaceFiles.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    content: text().notNull(),
    size: integer().notNull(),
    createdBy: text("created_by", { enum: ["agent", "user"] }).notNull(),
    sourceAgentId: text("source_agent_id"),
    sourceRunId: text("source_run_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("workspace_file_versions_file_created").on(
      table.fileId,
      table.createdAt,
    ),
  ],
);

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
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
    index("campaigns_workspace_updated").on(table.workspaceId, table.updatedAt),
  ],
);

export const recurringWork = sqliteTable(
  "recurring_work",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    title: text().notNull(),
    instructions: text().notNull(),
    cron: text().notNull(),
    timezone: text().notNull(),
    runOnceAt: integer("run_once_at"),
    status: text({
      enum: ["draft", "active", "paused", "needs_approval", "error"],
    }).notNull(),
    /** Where approved runs execute: this Mac's scheduler or the deployment. */
    placement: text({ enum: ["local", "cloud"] })
      .notNull()
      .default("local"),
    skipDates: text("skip_dates", { mode: "json" }).$type<string[]>(),
    approvalSummary: text("approval_summary").notNull(),
    proposedToolPatterns: text("proposed_tool_patterns", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    grant: text({ mode: "json" }).$type<{
      version: 1;
      approvedAt: number;
      toolPatterns: string[];
    }>(),
    nextRunAt: integer("next_run_at"),
    lastRunAt: integer("last_run_at"),
    lastResult: text("last_result"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("recurring_work_workspace_next").on(
      table.workspaceId,
      table.nextRunAt,
    ),
  ],
);

export const recurringWorkRuns = sqliteTable(
  "recurring_work_runs",
  {
    id: text().primaryKey(),
    recurringWorkId: text("recurring_work_id")
      .notNull()
      .references(() => recurringWork.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    status: text({
      enum: ["running", "completed", "waiting", "failed", "needs_approval"],
    }).notNull(),
    scheduledFor: integer("scheduled_for").notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    summary: text(),
    error: text(),
    artifacts: text({ mode: "json" }).$type<
      import("../types.js").RunResultArtifact[]
    >(),
    /** Executor addresses the grant declined during this run. */
    blockedTools: text("blocked_tools", { mode: "json" }).$type<string[]>(),
  },
  (table) => [
    index("recurring_runs_workspace_started").on(
      table.workspaceId,
      table.startedAt,
    ),
    // A recurring job may have many historical attempts, but never more than
    // one live attempt. This is a durable scheduler lease shared by installed,
    // dev, and recovering runtime processes rather than an in-memory promise.
    uniqueIndex("recurring_runs_one_active_per_work")
      .on(table.recurringWorkId)
      .where(sql`${table.status} = 'running'`),
  ],
);

export const agentPreferences = sqliteTable(
  "agent_preferences",
  {
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    enabled: integer({ mode: "boolean" }).notNull(),
    driver: text({ enum: ["claude", "codex", "opencode"] }),
    model: text(),
    capabilities: text({ mode: "json" }).$type<string[]>(),
    integrations: text({ mode: "json" }).$type<string[]>(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.agentId] })],
);

/**
 * Items an agent explicitly flagged for the user, each with a concrete
 * reason. This is the only source for the Overview attention surface —
 * routine output never lands here.
 */
export const attentionItems = sqliteTable(
  "attention_items",
  {
    id: text().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    title: text().notNull(),
    reason: text().notNull(),
    /** Optional deep link target, e.g. an automation or chat id. */
    sourceId: text("source_id"),
    status: text({ enum: ["open", "dismissed"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("attention_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);
