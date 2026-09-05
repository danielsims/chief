import { z } from "zod";

import type { ScheduleWebhook } from "@chief/relay-contracts";
import {
  jsonObjectSchema,
  scheduleWebhookActionSchema,
  scheduleWebhookCreateSchema,
  scheduleWebhookSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import {
  canMessageAgent,
  requireAgentMessageAccess,
} from "./workspace-agent-messaging";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { missionAllowsSchedule } from "./workspace-schedule-dispatch";
import { queueScheduleRun } from "./workspace-schedule-runs";
import {
  readWorkspaceSchedule,
  wakeWorkspaceSchedules,
} from "./workspace-schedule-store";

function readWebhook(storage: DurableObjectStorage, id: string) {
  const row = storage.sql
    .exec<{ document_json: string; secret: string }>(
      "SELECT document_json, secret FROM workspace_schedule_webhooks WHERE id = ?",
      id,
    )
    .toArray()[0];
  return row
    ? {
        webhook: scheduleWebhookSchema.parse(JSON.parse(row.document_json)),
        secret: row.secret,
      }
    : null;
}
function saveWebhook(
  storage: DurableObjectStorage,
  webhook: ScheduleWebhook,
  secret: string,
) {
  storage.sql.exec(
    "INSERT INTO workspace_schedule_webhooks(id, document_json, secret) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET document_json=excluded.document_json, secret=excluded.secret",
    webhook.id,
    JSON.stringify(webhook),
    secret,
  );
}
function newSecret() {
  return `whsec_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))}`;
}

export async function routeScheduleWebhooks(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
  operation: string,
) {
  if (operation === "webhooks-deliver")
    return receiveDelivery(storage, env, request);
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requireWorkspace(context.workspaceId);
  requireWorkspaceAdministrator(channels, context.principal);
  if (operation === "webhooks-list") {
    return json({
      webhooks: storage.sql
        .exec<{ document_json: string }>(
          "SELECT document_json FROM workspace_schedule_webhooks ORDER BY rowid DESC",
        )
        .toArray()
        .map((row) =>
          scheduleWebhookSchema.parse(JSON.parse(row.document_json)),
        )
        .filter((webhook) => {
          const schedule = readWorkspaceSchedule(storage, webhook.scheduleId);
          return (
            schedule &&
            [
              schedule.schedule.agentId,
              ...schedule.schedule.collaborators,
            ].every((agentId) =>
              canMessageAgent(channels, agentId, context.principal),
            ) &&
            channels.canReadConversation(
              schedule.schedule.conversationId,
              context.principal,
            )
          );
        }),
    });
  }
  if (operation === "webhooks-create") {
    const input = scheduleWebhookCreateSchema.parse(await parseJson(request));
    const schedule = readWorkspaceSchedule(storage, input.scheduleId);
    if (!schedule)
      throw new HttpError(
        404,
        "schedule_not_found",
        "Choose an existing schedule.",
      );
    for (const agentId of [
      schedule.schedule.agentId,
      ...schedule.schedule.collaborators,
    ])
      requireAgentMessageAccess(channels, agentId, context.principal);
    channels.requireChannelVisible(
      schedule.schedule.conversationId,
      context.principal,
    );
    if (
      storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM workspace_schedule_webhooks",
        )
        .one().count >= 250
    )
      throw new HttpError(
        409,
        "webhook_limit",
        "Remove an unused webhook before adding another.",
      );
    const id = crypto.randomUUID();
    const origin =
      request.headers.get("x-chief-public-origin") ?? env.RELAY_PUBLIC_URL;
    if (!origin) throw new Error("The relay public URL is unavailable.");
    const webhook = scheduleWebhookSchema.parse({
      ...input,
      id,
      enabled: true,
      url: `${origin}/v1/workspaces/${encodeURIComponent(context.workspaceId)}/webhooks/${id}/deliveries`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const secret = newSecret();
    saveWebhook(storage, webhook, secret);
    return json({ webhook, secret }, { status: 201 });
  }
  const id = request.headers.get("x-chief-webhook-id") ?? "";
  const current = readWebhook(storage, id);
  if (!current)
    throw new HttpError(
      404,
      "webhook_not_found",
      "This webhook no longer exists.",
    );
  const schedule = readWorkspaceSchedule(storage, current.webhook.scheduleId);
  if (schedule) {
    for (const agentId of [
      schedule.schedule.agentId,
      ...schedule.schedule.collaborators,
    ])
      requireAgentMessageAccess(channels, agentId, context.principal);
    channels.requireChannelVisible(
      schedule.schedule.conversationId,
      context.principal,
    );
  }
  const { action } = scheduleWebhookActionSchema.parse(
    await parseJson(request),
  );
  if (action === "delete") {
    storage.sql.exec(
      "DELETE FROM workspace_schedule_webhooks WHERE id = ?",
      id,
    );
    return json({ webhook: { ...current.webhook, enabled: false } });
  }
  const webhook = {
    ...current.webhook,
    updatedAt: Math.max(Date.now(), current.webhook.updatedAt + 1),
    enabled:
      action === "enable"
        ? true
        : action === "disable"
          ? false
          : current.webhook.enabled,
  };
  const secret = action === "rotate" ? newSecret() : current.secret;
  saveWebhook(storage, webhook, secret);
  return json({ webhook, ...(action === "rotate" ? { secret } : undefined) });
}

export async function boundedWebhookBody(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  )
    throw new HttpError(
      415,
      "webhook_content_type",
      "Send an application/json body.",
    );
  if (Number(request.headers.get("content-length")) > 65_536)
    throw new HttpError(
      413,
      "webhook_body_too_large",
      "Webhook bodies must be at most 64 KiB.",
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(400, "webhook_body_missing", "Send a JSON object.");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      const { done } = result;
      const value: unknown = result.value;
      if (done) break;
      const chunk = z.instanceof(Uint8Array).parse(value);
      bytes += chunk.length;
      if (bytes > 65_536)
        throw new HttpError(
          413,
          "webhook_body_too_large",
          "Webhook bodies must be at most 64 KiB.",
        );
      parts.push(chunk);
    }
  } finally {
    await reader.cancel();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new HttpError(400, "webhook_encoding", "Use UTF-8 JSON.");
  }
}

export async function verifyWebhookSignature(
  secret: string,
  headers: Headers,
  body: string,
  now = Date.now(),
) {
  const id = headers.get("webhook-id") ?? "";
  const timestamp = headers.get("webhook-timestamp") ?? "";
  const signatures = (headers.get("webhook-signature") ?? "")
    .split(" ")
    .slice(0, 5);
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(id) ||
    !/^\d{10}$/u.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    throw new HttpError(
      401,
      "webhook_signature_invalid",
      "A valid, recent webhook signature is required.",
    );
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  for (const signature of signatures) {
    if (!signature.startsWith("v1,")) continue;
    try {
      if (
        await crypto.subtle.verify(
          "HMAC",
          key,
          Uint8Array.from(atob(signature.slice(3)), (c) => c.charCodeAt(0)),
          signed,
        )
      )
        return id;
    } catch {
      /* Try another v1 signature, without exposing verification details. */
    }
  }
  throw new HttpError(
    401,
    "webhook_signature_invalid",
    "A valid, recent webhook signature is required.",
  );
}

async function receiveDelivery(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const id = request.headers.get("x-chief-webhook-id") ?? "";
  const initial = readWebhook(storage, id);
  if (!initial)
    throw new HttpError(404, "webhook_not_found", "Webhook not found.");
  const body = await boundedWebhookBody(request);
  const deliveryId = await verifyWebhookSignature(
    initial.secret,
    request.headers,
    body,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(
      400,
      "webhook_json_invalid",
      "Send a valid JSON object.",
    );
  }
  const input = jsonObjectSchema.parse(parsed);
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
  const bodyHash = Array.from(hash, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  // Recheck after signature I/O so disable/rotation revokes pending deliveries too.
  const current = readWebhook(storage, id);
  if (
    !current?.webhook.enabled ||
    current.webhook.updatedAt !== initial.webhook.updatedAt
  )
    throw new HttpError(
      409,
      "webhook_disabled",
      "This webhook is disabled or its secret changed.",
    );
  const previous = storage.sql
    .exec<{ run_id: string; body_hash: string }>(
      "SELECT run_id, body_hash FROM workspace_webhook_deliveries WHERE webhook_id = ? AND delivery_id = ?",
      id,
      deliveryId,
    )
    .toArray()[0];
  if (previous) {
    if (previous.body_hash !== bodyHash)
      throw new HttpError(
        409,
        "webhook_delivery_conflict",
        "This delivery id was already used with another body.",
      );
    return json({ runId: previous.run_id, duplicate: true }, { status: 202 });
  }
  const stored = readWorkspaceSchedule(storage, current.webhook.scheduleId);
  if (
    !stored?.approvedBy ||
    stored.schedule.status !== "active" ||
    !missionAllowsSchedule(storage, stored.schedule)
  )
    throw new HttpError(
      409,
      "schedule_inactive",
      "Approve and activate the schedule before delivering events.",
    );
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requireWorkspace(request.headers.get("x-chief-workspace-id") ?? "");
  requireWorkspaceAdministrator(channels, stored.approvedBy);
  channels.requireChannelVisible(
    stored.schedule.conversationId,
    stored.approvedBy,
  );
  const now = Date.now();
  const recent = storage.sql
    .exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM workspace_webhook_deliveries WHERE webhook_id = ? AND received_at > ?",
      id,
      now - 60_000,
    )
    .one().count;
  if (recent >= 60)
    throw new HttpError(
      429,
      "webhook_rate_limit",
      "This webhook accepts at most 60 deliveries per minute.",
    );
  const run = queueScheduleRun(storage, stored.schedule, stored.approvedBy, {
    id: crypto.randomUUID(),
    source: "webhook",
    sourceId: id,
    scheduledAt: now,
    input,
  });
  storage.sql.exec(
    "INSERT INTO workspace_webhook_deliveries(webhook_id, delivery_id, body_hash, run_id, received_at) VALUES (?, ?, ?, ?, ?)",
    id,
    deliveryId,
    bodyHash,
    run.id,
    now,
  );
  saveWebhook(
    storage,
    { ...current.webhook, lastDeliveryAt: now, lastRunId: run.id },
    current.secret,
  );
  await wakeWorkspaceSchedules(storage);
  return json({ runId: run.id, duplicate: false }, { status: 202 });
}
