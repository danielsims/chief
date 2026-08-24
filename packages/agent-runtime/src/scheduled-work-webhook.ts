import { createHash, timingSafeEqual } from "node:crypto";

import type { JsonValue } from "@chief/relay-contracts";
import { parseJsonObject } from "@chief/relay-contracts";

import type {
  ScheduledWorkManager,
  ScheduledWorkRunner,
} from "./scheduled-work-runtime.js";

export async function handleScheduledWorkWebhook(input: {
  path: string;
  body: JsonValue;
  idempotencyKey?: string;
  manager: ScheduledWorkManager & {
    recurringWorkWorkspaceId(
      scheduledWorkId: string,
    ): Promise<string | undefined>;
  };
  runner: ScheduledWorkRunner;
}) {
  const match = /^\/hooks\/scheduled-runs\/([^/]+)\/([^/]+)$/.exec(input.path);
  if (!match?.[1] || !match[2]) return { handled: false as const };
  const scheduledWorkId = decodeURIComponent(match[1]);
  const secret = decodeURIComponent(match[2]);
  const workspaceId =
    await input.manager.recurringWorkWorkspaceId(scheduledWorkId);
  if (!workspaceId) return notFound();
  const scheduledWork = await input.manager.recurringWorkById(
    workspaceId,
    scheduledWorkId,
  );
  if (
    scheduledWork?.trigger?.type !== "webhook" ||
    scheduledWork.status !== "active" ||
    !scheduledWork.grant
  ) {
    return notFound();
  }
  const expectedHash = await input.manager.scheduleWebhookSecretHash(
    workspaceId,
    scheduledWorkId,
  );
  const actualHash = createHash("sha256").update(secret).digest("hex");
  const validHash =
    expectedHash?.length === actualHash.length &&
    timingSafeEqual(Buffer.from(expectedHash), Buffer.from(actualHash));
  if (!validHash) {
    return notFound();
  }
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey) {
    return {
      handled: true as const,
      status: 400,
      value: { error: "Idempotency-Key is required." },
    };
  }
  if (idempotencyKey.length > 160) {
    return {
      handled: true as const,
      status: 400,
      value: { error: "Idempotency-Key must be at most 160 characters." },
    };
  }
  const triggerId = `webhook:${idempotencyKey}`;
  const prior = (
    await input.manager.scheduleRuns(workspaceId, scheduledWorkId)
  ).find((run) => run.triggerId === triggerId);
  if (prior) {
    return {
      handled: true as const,
      status: 202,
      value: { queued: false, replayed: true, runId: prior.id },
    };
  }
  const context = parseJsonObject(input.body) ?? { payload: input.body };
  void input.runner
    .runTriggered(workspaceId, scheduledWorkId, triggerId, {
      type: "webhook",
      receivedAt: Date.now(),
      payload: context,
    })
    .catch((error) =>
      console.error("[scheduled-work] webhook run failed:", error),
    );
  return { handled: true as const, status: 202, value: { queued: true } };
}

function notFound() {
  return {
    handled: true as const,
    status: 404,
    value: { error: "Not found" },
  };
}
