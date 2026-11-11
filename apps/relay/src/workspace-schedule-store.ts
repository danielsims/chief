import { DateTime } from "effect";
import { z } from "zod";

import type { WorkspaceSchedule } from "@chief/relay-contracts";
import { nextRunAt, runDateKey } from "@chief/agent-runtime/recurring-work";
import {
  principalSchema,
  workspaceScheduleSchema,
} from "@chief/relay-contracts";

import { initializeScheduleRunTables } from "./db/migrations/initialize-schedule-run-tables";
import { initializeScheduleTables } from "./db/migrations/initialize-schedule-tables";
import { externalAgentOutboxDeadline } from "./external-agent-outbox-deadline";
import { workspaceSchedulesFindNextDeadline } from "./queries/workspace-schedules/find-next-deadline";
import { workspaceSchedulesFindReadWorkspaceSchedule } from "./queries/workspace-schedules/find-read-workspace-schedule";
import { workspaceSchedulesFindReadWorkspaceSchedules } from "./queries/workspace-schedules/find-read-workspace-schedules";
import { workspaceSchedulesInsertWriteWorkspaceSchedule } from "./queries/workspace-schedules/insert-write-workspace-schedule";

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
  initializeScheduleRunTables(storage);
  initializeScheduleTables(storage);
}

export function readWorkspaceSchedules(storage: DurableObjectStorage) {
  return [
    ...workspaceSchedulesFindReadWorkspaceSchedules<ScheduleRow>(storage),
  ].map((row) => storedScheduleSchema.parse(JSON.parse(row.document_json)));
}

export function readWorkspaceSchedule(
  storage: DurableObjectStorage,
  id: string,
) {
  const row = [
    ...workspaceSchedulesFindReadWorkspaceSchedule<ScheduleRow>(storage, id),
  ][0];
  return row ? storedScheduleSchema.parse(JSON.parse(row.document_json)) : null;
}

export function writeWorkspaceSchedule(
  storage: DurableObjectStorage,
  value: StoredSchedule,
) {
  workspaceSchedulesInsertWriteWorkspaceSchedule(storage, {
    id: value.schedule.id,
    documentJson: JSON.stringify(value),
    nextAt:
      value.schedule.status === "active"
        ? (value.schedule.nextAt ?? null)
        : null,
  });
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
    ...workspaceSchedulesFindNextDeadline<
      { deadline: number | null } & Record<string, SqlStorageValue>
    >(storage),
  ][0];
  return row?.deadline ?? undefined;
}

export async function setWorkspaceAlarm(
  storage: DurableObjectStorage,
  externalDeadline?: number,
) {
  const scheduleAt = scheduleDeadline(storage);
  const deadlines = [
    scheduleAt,
    externalAgentOutboxDeadline(storage),
    externalDeadline,
  ].filter((value): value is number => value !== undefined);
  if (deadlines.length)
    await storage.setAlarm(Math.max(Date.now(), Math.min(...deadlines)));
  else await storage.deleteAlarm();
}

export async function wakeWorkspaceSchedules(storage: DurableObjectStorage) {
  // Derive the next wake-up from both durable queues, never a consumed or stale alarm.
  await setWorkspaceAlarm(storage);
}

export async function ensureWorkspaceAlarm(storage: DurableObjectStorage) {
  // An existing alarm may already be about to fire; leave it untouched on startup.
  if ((await storage.getAlarm()) === null)
    await wakeWorkspaceSchedules(storage);
}
