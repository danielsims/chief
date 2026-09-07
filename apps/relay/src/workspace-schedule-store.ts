import { DateTime } from "effect";
import { z } from "zod";

import type { WorkspaceSchedule } from "@chief/relay-contracts";
import { nextRunAt, runDateKey } from "@chief/agent-runtime/recurring-work";
import {
  principalSchema,
  workspaceScheduleSchema,
} from "@chief/relay-contracts";

const storedScheduleSchema = z.object({
  schedule: workspaceScheduleSchema,
  approvedBy: principalSchema.nullable(),
});
export type StoredSchedule = z.infer<typeof storedScheduleSchema>;

type ScheduleRow = { id: string; document_json: string } & Record<
  string,
  SqlStorageValue
>;

export function initializeWorkspaceSchedules(storage: DurableObjectStorage) {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS workspace_schedule_runs (
    id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, state TEXT NOT NULL,
    next_check_at INTEGER, created_at INTEGER NOT NULL, document_json TEXT NOT NULL, principal_json TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS schedule_runs_due ON workspace_schedule_runs(next_check_at);
  CREATE INDEX IF NOT EXISTS schedule_runs_history ON workspace_schedule_runs(schedule_id, created_at);
  CREATE TABLE IF NOT EXISTS workspace_schedule_webhooks (
    id TEXT PRIMARY KEY, document_json TEXT NOT NULL, secret TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS workspace_webhook_deliveries (
    webhook_id TEXT NOT NULL, delivery_id TEXT NOT NULL, body_hash TEXT NOT NULL, run_id TEXT NOT NULL,
    received_at INTEGER NOT NULL, PRIMARY KEY(webhook_id, delivery_id)
  );`);
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS workspace_schedules (
    id TEXT PRIMARY KEY, document_json TEXT NOT NULL, next_at INTEGER
  ); CREATE TABLE IF NOT EXISTS workspace_schedule_commands (command_id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, action TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workspace_schedule_dispatches (
    id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, scheduled_at INTEGER NOT NULL,
    command_id TEXT NOT NULL, message_id TEXT NOT NULL, state TEXT NOT NULL,
    retry_at INTEGER NOT NULL, error TEXT, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
  ); CREATE INDEX IF NOT EXISTS workspace_schedule_due ON workspace_schedules(next_at);
  CREATE INDEX IF NOT EXISTS workspace_schedule_dispatch_due ON workspace_schedule_dispatches(state, retry_at);`);
}

export function readWorkspaceSchedules(storage: DurableObjectStorage) {
  return [
    ...storage.sql.exec<ScheduleRow>(
      "SELECT id, document_json FROM workspace_schedules ORDER BY next_at, id",
    ),
  ].map((row) => storedScheduleSchema.parse(JSON.parse(row.document_json)));
}

export function readWorkspaceSchedule(
  storage: DurableObjectStorage,
  id: string,
) {
  const row = [
    ...storage.sql.exec<ScheduleRow>(
      "SELECT id, document_json FROM workspace_schedules WHERE id = ?",
      id,
    ),
  ][0];
  return row ? storedScheduleSchema.parse(JSON.parse(row.document_json)) : null;
}

export function writeWorkspaceSchedule(
  storage: DurableObjectStorage,
  value: StoredSchedule,
) {
  storage.sql.exec(
    "INSERT INTO workspace_schedules(id, document_json, next_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET document_json=excluded.document_json, next_at=excluded.next_at",
    value.schedule.id,
    JSON.stringify(value),
    value.schedule.status === "active" ? (value.schedule.nextAt ?? null) : null,
  );
}

export function nextScheduleTime(
  schedule: WorkspaceSchedule,
  after: number,
): number | undefined {
  if (schedule.triggerMode === "webhook") return undefined;
  if (schedule.onceAt !== undefined)
    return schedule.onceAt > after ? schedule.onceAt : undefined;
  let candidate = nextRunAt(schedule.cron, schedule.timezone, after);
  for (let attempt = 0; attempt <= 366; attempt += 1) {
    if (!schedule.skipDates.includes(runDateKey(candidate, schedule.timezone)))
      return candidate;
    const dayEnd = DateTime.toEpochMillis(
      DateTime.endOf(
        DateTime.makeZonedUnsafe(candidate, { timeZone: schedule.timezone }),
        "day",
      ),
    );
    candidate = nextRunAt(schedule.cron, schedule.timezone, dayEnd);
  }
  return candidate;
}

export function presentWorkspaceSchedule(schedule: WorkspaceSchedule) {
  if (schedule.status !== "active" || schedule.triggerMode === "webhook")
    return { ...schedule, upcomingRuns: [] };
  const now = Date.now();
  const runs: number[] = [];
  if (schedule.nextAt !== undefined && schedule.nextAt <= now)
    runs.push(schedule.nextAt);
  if (schedule.onceAt !== undefined)
    runs.push(schedule.nextAt ?? schedule.onceAt);
  else {
    let after = now;
    for (let count = 0; count < 32; count += 1) {
      const next = nextScheduleTime(schedule, after);
      if (next === undefined) break;
      runs.push(next);
      after = next;
    }
  }
  return { ...schedule, upcomingRuns: runs };
}

export function scheduleDeadline(storage: DurableObjectStorage) {
  const row = [
    ...storage.sql.exec<
      { deadline: number | null } & Record<string, SqlStorageValue>
    >(`SELECT MIN(deadline) AS deadline FROM (
    SELECT MIN(next_at) AS deadline FROM workspace_schedules
    UNION ALL SELECT MIN(next_check_at) AS deadline FROM workspace_schedule_runs
  )`),
  ][0];
  return row?.deadline ?? undefined;
}

export async function setWorkspaceAlarm(
  storage: DurableObjectStorage,
  externalDeadline?: number,
) {
  const scheduleAt = scheduleDeadline(storage);
  const deadlines = [scheduleAt, externalDeadline].filter(
    (value): value is number => value !== undefined,
  );
  if (deadlines.length)
    await storage.setAlarm(Math.max(Date.now(), Math.min(...deadlines)));
  else await storage.deleteAlarm();
}

export async function wakeWorkspaceSchedules(storage: DurableObjectStorage) {
  const alarm = await storage.getAlarm();
  await setWorkspaceAlarm(storage, alarm ?? undefined);
}
