import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { ScheduledWorkTrigger } from "@chief/channel-api";

export const schedules = sqliteTable(
  "schedule",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id").notNull(),
    conversationId: text("conversation_id"),
    agentId: text("agent_id").notNull(),
    title: text().notNull(),
    instructions: text().notNull(),
    cron: text().notNull(),
    timezone: text().notNull(),
    onceAt: integer("once_at"),
    trigger: text({ mode: "json" }).$type<ScheduledWorkTrigger>(),
    operationKey: text("operation_key"),
    version: integer().notNull().default(1),
    webhookSecretHash: text("webhook_secret_hash"),
    status: text({
      enum: ["draft", "active", "paused", "needs_approval", "error"],
    }).notNull(),
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
    nextAt: integer("next_at"),
    lastCompletedAt: integer("last_completed_at"),
    lastSummary: text("last_summary"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("schedule_organization_next").on(table.organizationId, table.nextAt),
    index("schedule_conversation").on(table.conversationId),
    uniqueIndex("schedule_organization_operation").on(
      table.organizationId,
      table.operationKey,
    ),
  ],
);
