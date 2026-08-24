import { createHash, randomBytes } from "node:crypto";

import type { RecurringWorkRecord } from "./types.js";
import { nextRunAt, validateCron } from "./recurring-work.js";

export interface RecurringWorkSettingsManager {
  recurringWorkById(
    workspaceId: string,
    workId: string,
  ): Promise<RecurringWorkRecord | undefined>;
  saveRecurringWork(
    workspaceId: string,
    work: RecurringWorkRecord,
  ): Promise<unknown>;
  setScheduleWebhookSecretHash(
    workspaceId: string,
    workId: string,
    hash: string | undefined,
  ): Promise<unknown>;
}

/** Applies user-editable schedule fields without widening the approved grant. */
export async function saveRecurringWorkSettings(
  manager: RecurringWorkSettingsManager,
  workspaceId: string,
  work: RecurringWorkRecord,
) {
  const existing = await manager.recurringWorkById(workspaceId, work.id);
  if (!existing) {
    throw new Error("Recurring work must be proposed by an agent first.");
  }
  if (work.grant) {
    const proposed = new Set(existing.proposedToolPatterns);
    if (work.grant.toolPatterns.some((pattern) => !proposed.has(pattern))) {
      throw new Error("Approval contains tools the agent did not propose.");
    }
  }

  const active = work.status === "active";
  if (active && !work.grant) {
    throw new Error("Explicit approval is required before activation.");
  }
  const now = Date.now();
  const missedOneOff =
    active && existing.onceAt !== undefined && existing.onceAt <= now;
  const requestedTrigger = work.trigger ?? {
    type: "cron" as const,
    expression: work.cron,
    timezone: work.timezone,
  };
  const trigger =
    requestedTrigger.type === "cron"
      ? {
          type: "cron" as const,
          expression: work.cron,
          timezone: work.timezone,
        }
      : requestedTrigger;

  let timing: Pick<
    RecurringWorkRecord,
    "cron" | "timezone" | "nextAt" | "onceAt"
  >;
  if (trigger.type === "cron") {
    validateCron(trigger.expression, trigger.timezone);
    timing = {
      cron: trigger.expression,
      timezone: trigger.timezone,
      nextAt: active
        ? nextRunAt(trigger.expression, trigger.timezone)
        : undefined,
      onceAt: undefined,
    };
  } else if (trigger.type === "webhook") {
    timing = {
      cron: "0 0 1 1 *",
      timezone: "UTC",
      nextAt: undefined,
      onceAt: undefined,
    };
  } else {
    timing = {
      cron: existing.cron,
      timezone: existing.timezone,
      nextAt: existing.nextAt,
      onceAt: existing.onceAt,
    };
  }

  const saved: RecurringWorkRecord = {
    ...existing,
    ...timing,
    title: work.title,
    trigger,
    placement: work.placement,
    skipDates: work.skipDates,
    status: work.status,
    grant: work.grant,
    nextAt: missedOneOff ? now : timing.nextAt,
    updatedAt: now,
  };
  await manager.saveRecurringWork(workspaceId, saved);
  if (existing.trigger?.type === "webhook" && trigger.type !== "webhook") {
    await manager.setScheduleWebhookSecretHash(
      workspaceId,
      existing.id,
      undefined,
    );
  }
  return { saved, missedOneOff };
}

/** Rotates a webhook credential and returns its local URL exactly once. */
export async function rotateRecurringWorkWebhook(
  manager: RecurringWorkSettingsManager,
  workspaceId: string,
  recurringWorkId: string,
  origin: string,
) {
  const work = await manager.recurringWorkById(workspaceId, recurringWorkId);
  if (work?.trigger?.type !== "webhook") {
    throw new Error("This scheduled work does not use a webhook trigger.");
  }
  const secret = randomBytes(32).toString("base64url");
  await manager.setScheduleWebhookSecretHash(
    workspaceId,
    recurringWorkId,
    createHash("sha256").update(secret).digest("hex"),
  );
  return `${origin}/hooks/scheduled-runs/${recurringWorkId}/${secret}`;
}
