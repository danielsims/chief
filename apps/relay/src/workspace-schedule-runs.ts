import type {
  Principal,
  ScheduleRun,
  WorkspaceSchedule,
} from "@chief/relay-contracts";
import { principalSchema, scheduleRunSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { workspaceScheduleRunsFindListScheduleRuns } from "./queries/workspace-schedule-runs/find-list-schedule-runs";
import { workspaceScheduleRunsFindQueueScheduleRun } from "./queries/workspace-schedule-runs/find-queue-schedule-run";
import { workspaceScheduleRunsFindReadScheduleRun } from "./queries/workspace-schedule-runs/find-read-schedule-run";
import { workspaceScheduleRunsInsertWriteScheduleRun } from "./queries/workspace-schedule-runs/insert-write-schedule-run";

export function readScheduleRun(storage: DurableObjectStorage, id: string) {
  const row = workspaceScheduleRunsFindReadScheduleRun<{
    document_json: string;
    principal_json: string;
  }>(storage, id)[0];
  return row
    ? {
        run: scheduleRunSchema.parse(JSON.parse(row.document_json)),
        principal: principalSchema.parse(JSON.parse(row.principal_json)),
      }
    : null;
}

export function writeScheduleRun(
  storage: DurableObjectStorage,
  run: ScheduleRun,
  principal: Principal,
) {
  workspaceScheduleRunsInsertWriteScheduleRun(storage, {
    id: run.id,
    scheduleId: run.scheduleId,
    state: run.state,
    nextCheckAt: run.nextCheckAt ?? null,
    createdAt: run.createdAt,
    documentJson: JSON.stringify(run),
    principalJson: JSON.stringify(principal),
  });
}

export function listScheduleRuns(
  storage: DurableObjectStorage,
  scheduleId: string,
) {
  return workspaceScheduleRunsFindListScheduleRuns<{ document_json: string }>(
    storage,
    scheduleId,
  ).map((row) => scheduleRunSchema.parse(JSON.parse(row.document_json)));
}

export function queueScheduleRun(
  storage: DurableObjectStorage,
  schedule: WorkspaceSchedule,
  principal: Principal,
  input: {
    id: string;
    source: ScheduleRun["source"];
    scheduledAt: number;
    sourceId?: string;
    retryOf?: string;
    input?: ScheduleRun["input"];
  },
) {
  const existing = readScheduleRun(storage, input.id);
  if (existing) {
    if (existing.run.scheduleId !== schedule.id)
      throw new HttpError(
        409,
        "run_id_conflict",
        "This run id is already in use.",
      );
    return existing.run;
  }
  const count =
    workspaceScheduleRunsFindQueueScheduleRun<{ count: number }>(storage)[0]
      ?.count ?? 0;
  if (count >= 100)
    throw new HttpError(
      429,
      "schedule_queue_full",
      "This workspace has 100 unfinished runs. Try again when some have finished.",
    );
  const collaborators = [...new Set(schedule.collaborators)].filter(
    (id) => id !== schedule.agentId,
  );
  const steps: ScheduleRun["steps"] = [];
  const add = (
    agentId: WorkspaceSchedule["agentId"],
    phase: ScheduleRun["steps"][number]["phase"],
  ) =>
    steps.push({
      id: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      agentId,
      phase,
      state: "pending",
    });
  if (collaborators.length) {
    add(schedule.agentId, "plan");
    collaborators.forEach((id) => add(id, "contribute"));
  }
  add(schedule.agentId, "finish");
  const now = Date.now();
  const run = scheduleRunSchema.parse({
    ...input,
    scheduleId: schedule.id,
    schedule,
    steps,
    threadRootId: crypto.randomUUID(),
    state: "queued",
    createdAt: now,
    updatedAt: now,
    nextCheckAt: now,
  });
  writeScheduleRun(storage, run, principal);
  return run;
}

export function scheduleRunIsActive(run: ScheduleRun) {
  return run.state === "queued" || run.state === "running";
}

export function finishScheduleRun(
  storage: DurableObjectStorage,
  id: string,
  state: "completed" | "failed" | "blocked" | "cancelled",
  summary: string,
) {
  const current = readScheduleRun(storage, id);
  if (!current || !scheduleRunIsActive(current.run)) return;
  const now = Date.now();
  writeScheduleRun(
    storage,
    {
      ...current.run,
      state,
      summary: summary.slice(0, 4000),
      completedAt: now,
      updatedAt: now,
      nextCheckAt: state === "completed" ? undefined : now,
    },
    current.principal,
  );
}

export function cancelQueuedScheduleRuns(
  storage: DurableObjectStorage,
  scheduleId: string,
) {
  for (const run of listScheduleRuns(storage, scheduleId)) {
    if (run.state === "queued")
      finishScheduleRun(
        storage,
        run.id,
        "cancelled",
        "The schedule was paused or removed before this run started.",
      );
  }
}
