import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";

import type {
  AgentAlarm,
  AgentEvent,
  CellStateValue,
  OutboxRecord,
  OutboxRecordState,
  ProjectLease,
  RunLeaseState,
} from "./types.js";
import * as schema from "../db/schema.js";

type Database = LibSQLDatabase;

export interface EnqueueOutcome {
  duplicate: boolean;
  position: number;
}

/** Durable per-cell storage: ordered events, state, alarms, leases, outbox. */
export interface CellPersistence {
  enqueue(cellId: string, event: AgentEvent): Promise<EnqueueOutcome>;
  lastEvent(
    cellId: string,
  ): Promise<{ id: string; position: number } | undefined>;
  events(cellId: string, afterPosition?: number): Promise<AgentEvent[]>;
  readState(cellId: string, key: string): Promise<CellStateValue | undefined>;
  writeState(cellId: string, key: string, value: CellStateValue): Promise<void>;
  listDueAlarms(cellId: string, now: number): Promise<AgentAlarm[]>;
  saveAlarm(cellId: string, alarm: AgentAlarm): Promise<void>;
  deleteAlarm(cellId: string, alarmId: string): Promise<void>;
  acquireLease(cellId: string, lease: RunLeaseState): Promise<boolean>;
  lease(cellId: string): Promise<RunLeaseState | undefined>;
  releaseLease(cellId: string, runId: string): Promise<void>;
  expireLeases(now: number): Promise<number>;
  saveProjectLease(cellId: string, lease: ProjectLease): Promise<void>;
  projectLease(
    cellId: string,
    leaseId: string,
  ): Promise<ProjectLease | undefined>;
  releaseProjectLease(cellId: string, leaseId: string): Promise<void>;
  cleanExpiredProjectLeases(now: number): Promise<number>;
  prepareOutbox(cellId: string, record: OutboxRecord): Promise<boolean>;
  markOutboxDelivered(cellId: string, id: string): Promise<void>;
  markOutboxFailed(cellId: string, id: string, error: string): Promise<void>;
  listOutbox(
    cellId: string,
    states?: OutboxRecordState[],
  ): Promise<OutboxRecord[]>;
}

function eventRecord(row: typeof schema.cellEvents.$inferSelect): AgentEvent {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload ?? undefined,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

function outboxRecord(
  row: typeof schema.cellOutbox.$inferSelect,
): OutboxRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    payload: row.payload ?? undefined,
    state: row.state,
    attempts: row.attempts,
    deliveredAt: row.deliveredAt ?? undefined,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
  };
}

/** SQLite-backed cell storage, serialized so positions stay gap-free. */
export class CellSqliteStore implements CellPersistence {
  constructor(
    private readonly database: () => Database,
    private readonly ready: Promise<void>,
  ) {}

  async enqueue(cellId: string, event: AgentEvent): Promise<EnqueueOutcome> {
    await this.ready;
    const db = this.database();
    const existing = await db
      .select({ position: schema.cellEvents.position })
      .from(schema.cellEvents)
      .where(
        and(
          eq(schema.cellEvents.cellId, cellId),
          eq(schema.cellEvents.idempotencyKey, event.idempotencyKey),
        ),
      )
      .get();
    if (existing) {
      return { duplicate: true, position: existing.position };
    }
    const last = await db
      .select({ position: schema.cellEvents.position })
      .from(schema.cellEvents)
      .where(eq(schema.cellEvents.cellId, cellId))
      .orderBy(desc(schema.cellEvents.position))
      .limit(1)
      .get();
    const position = (last?.position ?? 0) + 1;
    await db.insert(schema.cellEvents).values({
      cellId,
      position,
      id: event.id,
      type: event.type,
      payload: event.payload,
      idempotencyKey: event.idempotencyKey,
      createdAt: event.createdAt,
    });
    return { duplicate: false, position };
  }

  async lastEvent(cellId: string) {
    await this.ready;
    const row = await this.database()
      .select({
        id: schema.cellEvents.id,
        position: schema.cellEvents.position,
      })
      .from(schema.cellEvents)
      .where(eq(schema.cellEvents.cellId, cellId))
      .orderBy(desc(schema.cellEvents.position))
      .limit(1)
      .get();
    return row ?? undefined;
  }

  async events(cellId: string, afterPosition?: number) {
    await this.ready;
    const predicate = and(
      eq(schema.cellEvents.cellId, cellId),
      ...(afterPosition ? [gt(schema.cellEvents.position, afterPosition)] : []),
    );
    const rows = await this.database()
      .select()
      .from(schema.cellEvents)
      .where(predicate)
      .orderBy(asc(schema.cellEvents.position))
      .all();
    return rows.map(eventRecord);
  }

  async readState(cellId: string, key: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.cellState)
      .where(
        and(eq(schema.cellState.cellId, cellId), eq(schema.cellState.key, key)),
      )
      .get();
    return row?.value;
  }

  async writeState(cellId: string, key: string, value: CellStateValue) {
    await this.ready;
    await this.database()
      .insert(schema.cellState)
      .values({ cellId, key, value, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: [schema.cellState.cellId, schema.cellState.key],
        set: { value, updatedAt: Date.now() },
      })
      .run();
  }

  async listDueAlarms(cellId: string, now: number) {
    await this.ready;
    const rows = await this.database()
      .select()
      .from(schema.cellAlarms)
      .where(
        and(
          eq(schema.cellAlarms.cellId, cellId),
          lte(schema.cellAlarms.at, now),
        ),
      )
      .orderBy(asc(schema.cellAlarms.at))
      .all();
    return rows.map((row) => ({
      id: row.alarmId,
      at: row.at,
      payload: row.payload ?? undefined,
    }));
  }

  async saveAlarm(cellId: string, alarm: AgentAlarm) {
    await this.ready;
    await this.database()
      .insert(schema.cellAlarms)
      .values({
        cellId,
        alarmId: alarm.id,
        at: alarm.at,
        payload: alarm.payload,
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [schema.cellAlarms.cellId, schema.cellAlarms.alarmId],
        set: { at: alarm.at, payload: alarm.payload },
      })
      .run();
  }

  async deleteAlarm(cellId: string, alarmId: string) {
    await this.ready;
    await this.database()
      .delete(schema.cellAlarms)
      .where(
        and(
          eq(schema.cellAlarms.cellId, cellId),
          eq(schema.cellAlarms.alarmId, alarmId),
        ),
      )
      .run();
  }

  async acquireLease(cellId: string, lease: RunLeaseState) {
    await this.ready;
    const db = this.database();
    const active = await db
      .select()
      .from(schema.cellLeases)
      .where(eq(schema.cellLeases.cellId, cellId))
      .get();
    if (
      active &&
      active.expiresAt > Date.now() &&
      active.runId !== lease.runId
    ) {
      return false;
    }
    await db
      .insert(schema.cellLeases)
      .values({
        cellId,
        runId: lease.runId,
        agentId: lease.agentId,
        expiresAt: lease.expiresAt,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: [schema.cellLeases.cellId],
        set: {
          runId: lease.runId,
          agentId: lease.agentId,
          expiresAt: lease.expiresAt,
          updatedAt: Date.now(),
        },
      })
      .run();
    return true;
  }

  async lease(cellId: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.cellLeases)
      .where(eq(schema.cellLeases.cellId, cellId))
      .get();
    return row
      ? { runId: row.runId, agentId: row.agentId, expiresAt: row.expiresAt }
      : undefined;
  }

  async releaseLease(cellId: string, runId: string) {
    await this.ready;
    await this.database()
      .delete(schema.cellLeases)
      .where(
        and(
          eq(schema.cellLeases.cellId, cellId),
          eq(schema.cellLeases.runId, runId),
        ),
      )
      .run();
  }

  async expireLeases(now: number) {
    await this.ready;
    const result = await this.database()
      .delete(schema.cellLeases)
      .where(lte(schema.cellLeases.expiresAt, now))
      .run();
    return result.rowsAffected;
  }

  async saveProjectLease(cellId: string, lease: ProjectLease) {
    await this.ready;
    await this.database()
      .insert(schema.cellProjectLeases)
      .values({
        cellId,
        leaseId: lease.leaseId,
        projectId: lease.projectId,
        agentId: lease.agentId,
        checkoutId: lease.checkoutId,
        branch: lease.branch,
        expiresAt: lease.expiresAt,
        createdAt: Date.now(),
      })
      .run();
  }

  async projectLease(cellId: string, leaseId: string) {
    await this.ready;
    const row = await this.database()
      .select()
      .from(schema.cellProjectLeases)
      .where(
        and(
          eq(schema.cellProjectLeases.cellId, cellId),
          eq(schema.cellProjectLeases.leaseId, leaseId),
        ),
      )
      .get();
    return row
      ? {
          leaseId: row.leaseId,
          projectId: row.projectId,
          agentId: row.agentId,
          checkoutId: row.checkoutId ?? undefined,
          branch: row.branch ?? undefined,
          expiresAt: row.expiresAt,
        }
      : undefined;
  }

  async releaseProjectLease(cellId: string, leaseId: string) {
    await this.ready;
    await this.database()
      .delete(schema.cellProjectLeases)
      .where(
        and(
          eq(schema.cellProjectLeases.cellId, cellId),
          eq(schema.cellProjectLeases.leaseId, leaseId),
        ),
      )
      .run();
  }

  async cleanExpiredProjectLeases(now: number) {
    await this.ready;
    const result = await this.database()
      .delete(schema.cellProjectLeases)
      .where(lte(schema.cellProjectLeases.expiresAt, now))
      .run();
    return result.rowsAffected;
  }

  async prepareOutbox(cellId: string, record: OutboxRecord): Promise<boolean> {
    await this.ready;
    const db = this.database();
    const existing = await db
      .select({ id: schema.cellOutbox.id })
      .from(schema.cellOutbox)
      .where(
        and(
          eq(schema.cellOutbox.cellId, cellId),
          eq(schema.cellOutbox.idempotencyKey, record.idempotencyKey),
        ),
      )
      .get();
    if (existing) return false;
    await db.insert(schema.cellOutbox).values({
      cellId,
      id: record.id,
      idempotencyKey: record.idempotencyKey,
      kind: record.kind,
      payload: record.payload,
      state: "prepared",
      attempts: 0,
      createdAt: record.createdAt,
    });
    return true;
  }

  async markOutboxDelivered(cellId: string, id: string) {
    await this.ready;
    await this.database()
      .update(schema.cellOutbox)
      .set({ state: "delivered", deliveredAt: Date.now() })
      .where(
        and(eq(schema.cellOutbox.cellId, cellId), eq(schema.cellOutbox.id, id)),
      )
      .run();
  }

  async markOutboxFailed(cellId: string, id: string, error: string) {
    await this.ready;
    await this.database()
      .update(schema.cellOutbox)
      .set({
        state: "failed",
        attempts: sql`${schema.cellOutbox.attempts} + 1`,
        lastError: error.slice(0, 240),
      })
      .where(
        and(eq(schema.cellOutbox.cellId, cellId), eq(schema.cellOutbox.id, id)),
      )
      .run();
  }

  async listOutbox(cellId: string, states?: OutboxRecordState[]) {
    await this.ready;
    const predicate = and(
      eq(schema.cellOutbox.cellId, cellId),
      states?.length ? inArray(schema.cellOutbox.state, states) : undefined,
    );
    const rows = await this.database()
      .select()
      .from(schema.cellOutbox)
      .where(predicate)
      .orderBy(asc(schema.cellOutbox.createdAt))
      .all();
    return rows.map(outboxRecord);
  }
}
