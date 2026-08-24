import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { ScheduledWorkTrigger } from "@chief/channel-api";
import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  isJsonNumber,
  isJsonString,
  parseJsonObject,
  toJsonObject,
} from "@chief/relay-contracts";

import type {
  ScheduledWorkManager,
  ScheduledWorkRunner,
} from "./scheduled-work-runtime.js";
import type { RecurringWorkRecord } from "./types.js";
import { nextRunAt, validateCron } from "./recurring-work.js";
import { readWorkspaceContext } from "./workspace-context.js";

interface ScheduledWorkResult {
  handled: boolean;
  value?: JsonValue;
  status?: number;
}

class ScheduledWorkRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function fail(message: string, status = 400): never {
  throw new ScheduledWorkRequestError(message, status);
}

function text(input: JsonValue | undefined, name: string, maximum: number) {
  if (!isJsonString(input) || !input.trim()) fail(`${name} is required.`);
  return input.trim().slice(0, maximum);
}

function optionalText(
  input: JsonValue | undefined,
  name: string,
  maximum: number,
) {
  return input === undefined ? undefined : text(input, name, maximum);
}

function toolPatterns(input: JsonValue | undefined) {
  if (!Array.isArray(input) || input.length > 100) {
    fail("proposedToolPatterns must be a bounded array.");
  }
  const patterns = input.map((item) => text(item, "tool pattern", 240));
  return [...new Set(patterns)];
}

function timestamp(input: JsonValue | undefined, name: string) {
  const parsed = isJsonNumber(input)
    ? input
    : isJsonString(input)
      ? Date.parse(input)
      : Number.NaN;
  if (!Number.isFinite(parsed)) fail(`${name} must be a valid timestamp.`);
  return parsed;
}

function trigger(input: JsonValue | undefined): ScheduledWorkTrigger {
  const value = parseJsonObject(input);
  if (!value) {
    fail("trigger must be an object.");
  }
  const type = text(value.type, "trigger.type", 40);
  if (type === "cron") {
    const expression = text(value.expression, "trigger.expression", 120);
    const timezone = text(value.timezone, "trigger.timezone", 120);
    validateCron(expression, timezone);
    return { type, expression, timezone };
  }
  if (type === "once") return { type, at: timestamp(value.at, "trigger.at") };
  if (type === "webhook") return { type };
  if (type === "channel_mention") {
    return {
      type,
      channelId: text(value.channelId, "trigger.channelId", 160),
      memberId: optionalText(value.memberId, "trigger.memberId", 120),
    };
  }
  if (type === "channel_message") {
    const rawAuthorTypes = value.authorTypes;
    const authorTypes: ("user" | "agent")[] | undefined = Array.isArray(
      rawAuthorTypes,
    )
      ? rawAuthorTypes.map((authorType): "user" | "agent" => {
          if (authorType === "user") return "user";
          if (authorType === "agent") return "agent";
          return fail("trigger.authorTypes may contain user or agent.");
        })
      : undefined;
    return {
      type,
      channelId: text(value.channelId, "trigger.channelId", 160),
      contains: optionalText(value.contains, "trigger.contains", 500),
      authorTypes,
    };
  }
  if (type === "reaction_added") {
    return {
      type,
      channelId: text(value.channelId, "trigger.channelId", 160),
      emoji: optionalText(value.emoji, "trigger.emoji", 80),
    };
  }
  return fail(`Unsupported trigger type: ${type}.`);
}

function timing(resolved: ScheduledWorkTrigger) {
  if (resolved.type === "cron") {
    return {
      cron: resolved.expression,
      timezone: resolved.timezone,
      nextAt: nextRunAt(resolved.expression, resolved.timezone),
    };
  }
  if (resolved.type === "once") {
    return {
      cron: "0 0 1 1 *",
      timezone: "UTC",
      onceAt: resolved.at,
      nextAt: Math.max(Date.now(), resolved.at),
    };
  }
  return { cron: "0 0 1 1 *", timezone: "UTC" };
}

function automaticScheduling(workspaceId: string) {
  return (
    readWorkspaceContext(workspaceId)?.match(
      /^Agent scheduling authority:\s*(automatic|review|manual)$/im,
    )?.[1] === "automatic"
  );
}

function publicWork(work: RecurringWorkRecord) {
  return toJsonObject({ ...work, webhookSecret: undefined });
}

export async function handleScheduledWorkLocalTool(input: {
  request: Request;
  workspaceId: string;
  body: JsonObject;
  manager: ScheduledWorkManager;
  runner?: ScheduledWorkRunner;
  conversationId?: string;
  origin: string;
}): Promise<ScheduledWorkResult> {
  const {
    request,
    workspaceId,
    body,
    manager,
    runner,
    conversationId,
    origin,
  } = input;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/local-tools/scheduled-work"))
    return { handled: false };
  try {
    if (url.pathname === "/local-tools/scheduled-work") {
      if (request.method === "GET") {
        return {
          handled: true,
          value: {
            scheduledWork: (
              await manager.workspaceData(workspaceId)
            ).recurringWork.map(publicWork),
          },
        };
      }
      if (request.method === "POST") {
        const operationKey = text(body.operationKey, "operationKey", 100);
        if (!/^[a-z0-9][a-z0-9-]{4,99}$/.test(operationKey))
          fail("operationKey must be a stable lowercase slug.");
        const prior = await manager.recurringWorkByOperationKey(
          workspaceId,
          operationKey,
        );
        if (prior)
          return {
            handled: true,
            value: { scheduledWork: publicWork(prior), replayed: true },
          };
        const resolvedTrigger = trigger(body.trigger);
        const now = Date.now();
        const activate =
          body.activate === true && automaticScheduling(workspaceId);
        const proposedToolPatterns = toolPatterns(body.proposedToolPatterns);
        const work: RecurringWorkRecord = {
          id: randomUUID(),
          conversationId:
            optionalText(body.conversationId, "conversationId", 160) ??
            conversationId,
          agentId: text(body.agentId, "agentId", 120),
          title: text(body.title, "title", 200),
          instructions: text(body.instructions, "instructions", 8_000),
          ...timing(resolvedTrigger),
          trigger: resolvedTrigger,
          operationKey,
          version: 1,
          status: activate ? "active" : "draft",
          placement: "local",
          approvalSummary: text(body.approvalSummary, "approvalSummary", 2_000),
          proposedToolPatterns,
          grant: activate
            ? {
                version: 1,
                approvedAt: now,
                toolPatterns: proposedToolPatterns,
              }
            : undefined,
          createdAt: now,
          updatedAt: now,
        };
        await manager.saveRecurringWork(workspaceId, work);
        if (!activate) {
          await manager.raiseActionItem(workspaceId, {
            id: `action-${work.id}-approval`,
            agentId: work.agentId,
            title: `Approve: ${work.title}`,
            reason: work.approvalSummary,
            sourceId: `automation-${work.id}`,
            status: "open",
            createdAt: now,
          });
        }
        return {
          handled: true,
          value: {
            scheduledWork: publicWork(work),
            requiresUserApproval: !activate,
          },
        };
      }
    }

    const match = /^\/local-tools\/scheduled-work\/([^/]+)(?:\/(.*))?$/.exec(
      url.pathname,
    );
    if (!match?.[1]) return { handled: false };
    const scheduledWorkId = decodeURIComponent(match[1]);
    const tail = match[2] ?? "";
    const existing = await manager.recurringWorkById(
      workspaceId,
      scheduledWorkId,
    );
    if (!existing) fail("Scheduled work was not found.", 404);

    if (!tail && request.method === "GET")
      return { handled: true, value: { scheduledWork: publicWork(existing) } };
    if (!tail && request.method === "PATCH") {
      const expectedVersion = isJsonNumber(body.expectedVersion)
        ? body.expectedVersion
        : undefined;
      if (expectedVersion !== undefined && expectedVersion !== existing.version)
        fail("Scheduled work changed since it was read.", 409);
      const resolvedTrigger =
        body.trigger === undefined
          ? (existing.trigger ??
            trigger({
              type: "cron",
              expression: existing.cron,
              timezone: existing.timezone,
            }))
          : trigger(body.trigger);
      const proposed =
        body.proposedToolPatterns === undefined
          ? existing.proposedToolPatterns
          : toolPatterns(body.proposedToolPatterns);
      const existingGrant = existing.grant;
      const grantWidens = Boolean(
        existingGrant &&
        proposed.some(
          (pattern) => !existingGrant.toolPatterns.includes(pattern),
        ),
      );
      const narrowedGrant =
        existingGrant && !grantWidens
          ? { ...existingGrant, toolPatterns: proposed }
          : undefined;
      const updated: RecurringWorkRecord = {
        ...existing,
        title: optionalText(body.title, "title", 200) ?? existing.title,
        instructions:
          optionalText(body.instructions, "instructions", 8_000) ??
          existing.instructions,
        agentId: optionalText(body.agentId, "agentId", 120) ?? existing.agentId,
        ...timing(resolvedTrigger),
        trigger: resolvedTrigger,
        proposedToolPatterns: proposed,
        grant: narrowedGrant,
        status: grantWidens ? "draft" : existing.status,
        version: (existing.version ?? 0) + 1,
        updatedAt: Date.now(),
      };
      await manager.saveRecurringWork(workspaceId, updated);
      if (
        existing.trigger?.type === "webhook" &&
        resolvedTrigger.type !== "webhook"
      ) {
        await manager.setScheduleWebhookSecretHash(
          workspaceId,
          existing.id,
          undefined,
        );
      }
      return {
        handled: true,
        value: {
          scheduledWork: publicWork(updated),
          requiresUserApproval: grantWidens,
        },
      };
    }
    if (tail === "pause" && request.method === "POST") {
      const updated = {
        ...existing,
        status: "paused" as const,
        nextAt: undefined,
        version: (existing.version ?? 0) + 1,
        updatedAt: Date.now(),
      };
      await manager.saveRecurringWork(workspaceId, updated);
      return { handled: true, value: { scheduledWork: publicWork(updated) } };
    }
    if (tail === "resume" && request.method === "POST") {
      if (!existing.grant) fail("Approve this work before resuming it.", 409);
      const resolvedTrigger = existing.trigger ?? {
        type: "cron" as const,
        expression: existing.cron,
        timezone: existing.timezone,
      };
      const updated = {
        ...existing,
        ...timing(resolvedTrigger),
        status: "active" as const,
        version: (existing.version ?? 0) + 1,
        updatedAt: Date.now(),
      };
      await manager.saveRecurringWork(workspaceId, updated);
      return { handled: true, value: { scheduledWork: publicWork(updated) } };
    }
    if (!tail && request.method === "DELETE") {
      fail(
        "Agents archive or pause scheduled work; only the owner can permanently delete it.",
        403,
      );
    }
    if (tail === "runs" && request.method === "GET") {
      return {
        handled: true,
        value: toJsonObject({
          runs: await manager.scheduleRuns(workspaceId, existing.id),
        }),
      };
    }
    if (tail === "runs" && request.method === "POST") {
      if (!runner) fail("The scheduler is not ready.", 503);
      const idempotencyKey = optionalText(
        body.idempotencyKey,
        "idempotencyKey",
        160,
      );
      if (idempotencyKey) {
        const prior = (
          await manager.scheduleRuns(workspaceId, existing.id)
        ).find((run) => run.triggerId === `manual:${idempotencyKey}`);
        if (prior)
          return {
            handled: true,
            value: toJsonObject({ run: prior, replayed: true }),
          };
        void runner
          .runTriggered(workspaceId, existing.id, `manual:${idempotencyKey}`, {
            type: "manual",
            requestedAt: Date.now(),
          })
          .catch((error) =>
            console.error("[scheduled-work] manual run failed:", error),
          );
      } else {
        void runner
          .runNow(workspaceId, existing.id)
          .catch((error) =>
            console.error("[scheduled-work] manual run failed:", error),
          );
      }
      return { handled: true, status: 202, value: { queued: true } };
    }
    const runMatch = /^runs\/([^/]+)(?:\/(cancel|retry))?$/.exec(tail);
    if (runMatch?.[1]) {
      const runId = decodeURIComponent(runMatch[1]);
      const run = await manager.scheduleRun(workspaceId, existing.id, runId);
      if (!run) fail("Run was not found.", 404);
      if (!runMatch[2] && request.method === "GET")
        return { handled: true, value: toJsonObject({ run }) };
      if (runMatch[2] === "cancel" && request.method === "POST") {
        if (!runner) fail("The scheduler is not ready.", 503);
        return {
          handled: true,
          value: { cancelled: await runner.cancelRun(run.id) },
        };
      }
      if (runMatch[2] === "retry" && request.method === "POST") {
        if (!runner) fail("The scheduler is not ready.", 503);
        if (!["failed", "needs_approval", "completed"].includes(run.status))
          fail("Only a finished run can be retried.", 409);
        const retryId = `retry:${run.id}:${run.attempt + 1}`;
        void runner
          .runTriggered(
            workspaceId,
            existing.id,
            retryId,
            parseJsonObject(run.triggerContext) ?? {
              type: "retry",
              runId: run.id,
            },
          )
          .catch((error) =>
            console.error("[scheduled-work] retry failed:", error),
          );
        return {
          handled: true,
          status: 202,
          value: { queued: true, triggerId: retryId },
        };
      }
    }
    if (tail === "webhook" && request.method === "GET") {
      return {
        handled: true,
        value: {
          configured: Boolean(
            await manager.scheduleWebhookSecretHash(workspaceId, existing.id),
          ),
          reachability: "local_only",
        },
      };
    }
    if (tail === "webhook/rotate" && request.method === "POST") {
      if (existing.trigger?.type !== "webhook")
        fail("This scheduled work does not use a webhook trigger.", 409);
      const secret = randomBytes(32).toString("base64url");
      await manager.setScheduleWebhookSecretHash(
        workspaceId,
        existing.id,
        createHash("sha256").update(secret).digest("hex"),
      );
      return {
        handled: true,
        value: {
          url: `${origin}/hooks/scheduled-runs/${existing.id}/${secret}`,
          reachability: "local_only",
        },
      };
    }
    return { handled: false };
  } catch (error) {
    return {
      handled: true,
      status: error instanceof ScheduledWorkRequestError ? error.status : 400,
      value: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}
