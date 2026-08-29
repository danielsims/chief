import type { JsonObject } from "@chief/relay-contracts";

import type {
  ActionItem,
  RecurringWorkRecord,
  SessionRecord,
} from "./types.js";

export interface ScheduledWorkRunner {
  runNow(workspaceId: string, scheduledWorkId: string): Promise<void>;
  runTriggered(
    workspaceId: string,
    scheduledWorkId: string,
    triggerId: string,
    context: JsonObject,
  ): Promise<void>;
  cancelRun(runId: string): Promise<boolean>;
}

export interface ScheduledWorkManager {
  workspaceData(
    workspaceId: string,
  ): Promise<{ recurringWork: RecurringWorkRecord[] }>;
  recurringWorkByOperationKey(
    workspaceId: string,
    operationKey: string,
  ): Promise<RecurringWorkRecord | undefined>;
  recurringWorkById(
    workspaceId: string,
    scheduledWorkId: string,
  ): Promise<RecurringWorkRecord | undefined>;
  saveRecurringWork(
    workspaceId: string,
    work: RecurringWorkRecord,
  ): Promise<void>;
  raiseActionItem(workspaceId: string, action: ActionItem): Promise<void>;
  scheduleRuns(
    workspaceId: string,
    scheduledWorkId: string,
  ): Promise<SessionRecord[]>;
  scheduleRun(
    workspaceId: string,
    scheduledWorkId: string,
    runId: string,
  ): Promise<SessionRecord | undefined>;
  scheduleWebhookSecretHash(
    workspaceId: string,
    scheduledWorkId: string,
  ): Promise<string | undefined>;
  setScheduleWebhookSecretHash(
    workspaceId: string,
    scheduledWorkId: string,
    hash: string | undefined,
  ): Promise<void>;
}
