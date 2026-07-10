import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
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
