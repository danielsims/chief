import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { JsonValue } from "@chief/relay-contracts";

import type { CellStateValue } from "../cells/types.js";

export const cellEvents = sqliteTable(
  "cell_event",
  {
    cellId: text("cell_id").notNull(),
    position: integer().notNull(),
    id: text().notNull(),
    type: text().notNull(),
    payload: text({ mode: "json" }).$type<JsonValue>(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cellId, table.position] }),
    uniqueIndex("cell_event_idempotency").on(
      table.cellId,
      table.idempotencyKey,
    ),
    index("cell_event_timeline").on(table.cellId, table.position),
  ],
);

export const cellState = sqliteTable(
  "cell_state",
  {
    cellId: text("cell_id").notNull(),
    key: text().notNull(),
    value: text({ mode: "json" }).$type<CellStateValue>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.cellId, table.key] })],
);

export const cellAlarms = sqliteTable(
  "cell_alarm",
  {
    cellId: text("cell_id").notNull(),
    alarmId: text("alarm_id").notNull(),
    at: integer().notNull(),
    payload: text({ mode: "json" }).$type<JsonValue>(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cellId, table.alarmId] }),
    index("cell_alarm_due").on(table.cellId, table.at),
  ],
);

export const cellLeases = sqliteTable(
  "cell_lease",
  {
    cellId: text("cell_id").notNull(),
    runId: text("run_id").notNull(),
    agentId: text("agent_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.cellId] })],
);

export const cellProjectLeases = sqliteTable(
  "cell_project_lease",
  {
    cellId: text("cell_id").notNull(),
    leaseId: text("lease_id").notNull(),
    projectId: text("project_id").notNull(),
    agentId: text("agent_id").notNull(),
    checkoutId: text("checkout_id"),
    branch: text(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cellId, table.leaseId] }),
    index("cell_project_lease_due").on(table.cellId, table.expiresAt),
  ],
);

export const cellOutbox = sqliteTable(
  "cell_outbox",
  {
    cellId: text("cell_id").notNull(),
    id: text().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text().notNull(),
    payload: text({ mode: "json" }).$type<JsonValue>(),
    state: text({ enum: ["prepared", "delivered", "failed"] }).notNull(),
    attempts: integer().notNull().default(0),
    deliveredAt: integer("delivered_at"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cellId, table.id] }),
    uniqueIndex("cell_outbox_idempotency").on(
      table.cellId,
      table.idempotencyKey,
    ),
    index("cell_outbox_pending").on(table.cellId, table.state),
  ],
);
