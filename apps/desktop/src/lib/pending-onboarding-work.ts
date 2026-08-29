import type {
  DriverType,
  OnboardingSchedule,
  OnboardingWorkJob,
  RecurringWorkRecord,
} from "@chief/agent-runtime/types";
import { nextRunAt } from "@chief/agent-runtime/recurring-work";
import {
  isJsonNumber,
  isJsonString,
  parseJsonObject,
} from "@chief/relay-contracts";

import type { WorkspaceDataState } from "./workspace-data";

export function relayNeedsPendingOnboardingReplay(
  workspaceId: string,
  snapshot: { id: string; onboardingComplete: boolean } | null,
) {
  return snapshot?.id !== workspaceId || !snapshot.onboardingComplete;
}

export function pendingOnboardingWorkStorageKey(workspaceId: string) {
  return `chief:onboarding-work:${workspaceId}`;
}

export function readPendingOnboardingWork(workspaceId: string) {
  return window.localStorage.getItem(
    pendingOnboardingWorkStorageKey(workspaceId),
  );
}

function parsePendingSchedules(value: string | null) {
  if (!value) return [];
  try {
    const pending = parseJsonObject(JSON.parse(value));
    return Array.isArray(pending?.schedules)
      ? pending.schedules.flatMap((schedule): OnboardingSchedule[] =>
          parseOnboardingSchedule(schedule),
        )
      : [];
  } catch {
    return [];
  }
}

function parseOnboardingSchedule(value: unknown): OnboardingSchedule[] {
  const schedule = parseJsonObject(value);
  if (
    !schedule ||
    !isJsonString(schedule.id) ||
    !isJsonString(schedule.playbookId) ||
    !isJsonString(schedule.agentId) ||
    !isJsonString(schedule.title) ||
    !isJsonString(schedule.instructions) ||
    !isJsonString(schedule.cron) ||
    !isJsonString(schedule.timezone) ||
    !isJsonString(schedule.approvalSummary) ||
    !Array.isArray(schedule.proposedToolPatterns) ||
    !schedule.proposedToolPatterns.every(isJsonString) ||
    (schedule.status !== "active" && schedule.status !== "draft")
  ) {
    return [];
  }
  return [
    {
      id: schedule.id,
      playbookId: schedule.playbookId,
      agentId: schedule.agentId,
      title: schedule.title,
      instructions: schedule.instructions,
      cron: schedule.cron,
      timezone: schedule.timezone,
      status: schedule.status,
      approvalSummary: schedule.approvalSummary,
      proposedToolPatterns: schedule.proposedToolPatterns,
    },
  ];
}

export interface PendingOnboardingBootstrap {
  jobs: OnboardingWorkJob[];
  schedules: OnboardingSchedule[];
  workspaceContext?: string;
  driver?: DriverType;
  model?: string | null;
}

export function parsePendingOnboardingBootstrap(
  serialized: string,
): PendingOnboardingBootstrap | null {
  const pending = parseJsonObject(JSON.parse(serialized));
  if (
    !pending ||
    !Array.isArray(pending.jobs) ||
    !Array.isArray(pending.schedules)
  ) {
    return null;
  }
  const jobs = pending.jobs.flatMap(parseOnboardingWorkJob);
  const schedules = pending.schedules.flatMap(parseOnboardingSchedule);
  if (
    jobs.length !== pending.jobs.length ||
    schedules.length !== pending.schedules.length
  ) {
    return null;
  }
  const workspaceContext = pending.workspaceContext;
  const driver = pending.driver;
  const model = pending.model;
  if (
    (workspaceContext !== undefined && !isJsonString(workspaceContext)) ||
    (driver !== undefined &&
      driver !== "claude" &&
      driver !== "codex" &&
      driver !== "opencode" &&
      driver !== "remote") ||
    (model !== undefined && model !== null && !isJsonString(model))
  ) {
    return null;
  }
  return {
    jobs,
    schedules,
    ...(workspaceContext ? { workspaceContext } : undefined),
    ...(driver ? { driver } : undefined),
    ...(model === null || model ? { model } : undefined),
  };
}

function parseOnboardingWorkJob(value: unknown): OnboardingWorkJob[] {
  const job = parseJsonObject(value);
  if (
    !job ||
    !isJsonString(job.id) ||
    !isJsonString(job.agentId) ||
    !isJsonString(job.title) ||
    !isJsonString(job.instructions) ||
    !isJsonNumber(job.runAt) ||
    !isJsonString(job.timezone) ||
    !Array.isArray(job.proposedToolPatterns) ||
    !job.proposedToolPatterns.every(isJsonString)
  ) {
    return [];
  }
  const rawAttachments = job.attachments;
  const attachments = Array.isArray(rawAttachments)
    ? rawAttachments.flatMap((attachment) => {
        const parsed = parseJsonObject(attachment);
        return parsed &&
          isJsonString(parsed.name) &&
          isJsonString(parsed.type) &&
          isJsonString(parsed.dataUrl)
          ? [{ name: parsed.name, type: parsed.type, dataUrl: parsed.dataUrl }]
          : [];
      })
    : undefined;
  if (
    Array.isArray(rawAttachments) &&
    attachments &&
    attachments.length !== rawAttachments.length
  ) {
    return [];
  }
  return [
    {
      id: job.id,
      agentId: job.agentId,
      title: job.title,
      instructions: job.instructions,
      runAt: job.runAt,
      timezone: job.timezone,
      proposedToolPatterns: job.proposedToolPatterns,
      ...(isJsonString(job.setupDomain)
        ? { setupDomain: job.setupDomain }
        : undefined),
      ...(isJsonString(job.setupAttemptId)
        ? { setupAttemptId: job.setupAttemptId }
        : undefined),
      ...(attachments ? { attachments } : undefined),
    },
  ];
}

/** Builds the schedule rows that onboarding has queued but the runtime has not returned yet. */
export function pendingOnboardingSchedules(
  workspaceId: string,
  now = Date.now(),
): RecurringWorkRecord[] {
  return parsePendingSchedules(readPendingOnboardingWork(workspaceId)).flatMap(
    (schedule) => {
      try {
        return [
          {
            id: schedule.id,
            agentId: schedule.agentId,
            title: schedule.title,
            instructions: schedule.instructions,
            cron: schedule.cron,
            timezone: schedule.timezone,
            status: schedule.status,
            placement: "local",
            approvalSummary: schedule.approvalSummary,
            proposedToolPatterns: schedule.proposedToolPatterns,
            grant:
              schedule.status === "active"
                ? {
                    version: 1,
                    approvedAt: now,
                    toolPatterns: schedule.proposedToolPatterns,
                  }
                : undefined,
            nextAt:
              schedule.status === "active"
                ? nextRunAt(schedule.cron, schedule.timezone, now)
                : undefined,
            createdAt: now,
            updatedAt: now,
          },
        ];
      } catch {
        return [];
      }
    },
  );
}

/** Keeps queued onboarding schedules visible until a runtime snapshot contains them. */
export function mergePendingOnboardingSchedules(
  workspaceId: string,
  data: WorkspaceDataState,
  now = Date.now(),
): WorkspaceDataState {
  const pending = pendingOnboardingSchedules(workspaceId, now);
  if (pending.length === 0) return data;
  const existingById = new Map(
    data.recurringWork.map((work) => [work.id, work]),
  );
  return {
    ...data,
    recurringWork: [
      ...pending.map((work) => existingById.get(work.id) ?? work),
      ...data.recurringWork.filter(
        (work) => !pending.some((queued) => queued.id === work.id),
      ),
    ],
  };
}

/** Clear only after the runtime acknowledges the complete onboarding run. */
export function completePendingOnboardingWork(workspaceId: string) {
  window.localStorage.removeItem(pendingOnboardingWorkStorageKey(workspaceId));
}
