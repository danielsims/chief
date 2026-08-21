import type {
  OnboardingSchedule,
  RecurringWorkRecord,
} from "@chief/agent-runtime/types";
import { nextRunAt } from "@chief/agent-runtime/recurring-work";

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
    const pending = JSON.parse(value) as { schedules?: OnboardingSchedule[] };
    return Array.isArray(pending.schedules) ? pending.schedules : [];
  } catch {
    return [];
  }
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
