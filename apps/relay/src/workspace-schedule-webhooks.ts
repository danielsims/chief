import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import {
  automationWebhookEventListSchema,
  automationWebhookEventSchema,
  automationWebhookListSchema,
  automationWebhookRequestSchema,
  automationWebhookRevokedSchema,
  automationWebhookSchema,
  jsonObjectSchema,
} from "@chief/relay-contracts";

import type { SealPurpose } from "./sealed-secret";
import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { workspaceScheduleWebhooksDeleteRouteScheduleWebhooks } from "./queries/workspace-schedule-webhooks/delete-route-schedule-webhooks";
import { workspaceScheduleWebhooksFindListWebhooks } from "./queries/workspace-schedule-webhooks/find-list-webhooks";
import { workspaceScheduleWebhooksFindReadWebhook } from "./queries/workspace-schedule-webhooks/find-read-webhook";
import { workspaceScheduleWebhooksFindRouteScheduleWebhooksCount } from "./queries/workspace-schedule-webhooks/find-route-schedule-webhooks-count";
import { workspaceScheduleWebhooksInsertSaveWebhook } from "./queries/workspace-schedule-webhooks/insert-save-webhook";
import { workspaceScheduleWebhooksUpdateSigningSecret } from "./queries/workspace-schedule-webhooks/update-signing-secret";
import { workspaceWebhookDeliveriesFindReceiveDelivery } from "./queries/workspace-webhook-deliveries/find-receive-delivery";
import { workspaceWebhookDeliveriesFindReceiveDeliveryCount } from "./queries/workspace-webhook-deliveries/find-receive-delivery-count";
import { workspaceWebhookDeliveriesInsertReceiveDelivery } from "./queries/workspace-webhook-deliveries/insert-receive-delivery";
import { workspaceWebhookEventsDeleteEvents } from "./queries/workspace-webhook-events/delete-events";
import { workspaceWebhookEventsFindLatestEvents } from "./queries/workspace-webhook-events/find-latest-events";
import { workspaceWebhookEventsInsertEvent } from "./queries/workspace-webhook-events/insert-event";
import { openSecret, sealSecret } from "./sealed-secret";
import { timingSafeEqual } from "./timing-safe-equal";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import {
  canMessageAgent,
  requireAgentMessageAccess,
} from "./workspace-agent-messaging";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { queueScheduleRun } from "./workspace-schedule-runs";
import {
  readWorkspaceSchedule,
  wakeWorkspaceSchedules,
} from "./workspace-schedule-store";

/**
 * Each automation has one inbound URL, keyed by its schedule id. The URL can
 * be issued while the automation is still a draft, so it can be pasted into
 * the sending app before the first save; deliveries only start runs once the
 * automation is approved and on.
 */
const maximumBodyBytes = 65_536;

/** 32 random bytes, base64url without padding. */
export const webhookTokenPattern = /^[\w-]{43}$/u;

/**
 * What is stored. The URL token and the sealed signing secret live in their
 * own columns, so neither can reach a response by being spread from here.
 */
const storedWebhookSchema = automationWebhookSchema.omit({
  url: true,
  signed: true,
});
type StoredWebhook = z.infer<typeof storedWebhookSchema>;

interface WebhookRow extends Record<string, SqlStorageValue> {
  document_json: string;
  secret: string;
  signing_secret: string | null;
}

function readWebhook(storage: DurableObjectStorage, scheduleId: string) {
  const row = workspaceScheduleWebhooksFindReadWebhook<WebhookRow>(
    storage,
    scheduleId,
  )[0];
  return row
    ? {
        webhook: storedWebhookSchema.parse(JSON.parse(row.document_json)),
        token: row.secret,
        sealedSigningSecret: row.signing_secret,
      }
    : null;
}

/**
 * Signing secrets are write-only: they are sealed on save, opened only to
 * check a delivery, and never returned to anyone, workspace owners included.
 */
const signingPurpose: SealPurpose = {
  info: "chief/webhook-signing-secrets/v1",
  version: "w1",
};

const signingAdditionalData = (workspaceId: string, scheduleId: string) =>
  JSON.stringify(["webhook-signing-secret", 1, workspaceId, scheduleId]);

/** Standard Webhooks keys are 24 to 64 random bytes; refuse anything weaker. */
function signingKeyBytes(secret: string) {
  try {
    const bytes = Uint8Array.from(atob(secret.slice("whsec_".length)), (c) =>
      c.charCodeAt(0),
    );
    if (bytes.length >= 16 && bytes.length <= 128) return bytes;
  } catch {
    /* Reported below. */
  }
  throw new HttpError(
    400,
    "webhook_signing_secret_invalid",
    "That doesn't look like a complete signing secret. Copy it again from the sending app.",
  );
}

function saveWebhook(
  storage: DurableObjectStorage,
  webhook: StoredWebhook,
  token: string,
) {
  workspaceScheduleWebhooksInsertSaveWebhook(storage, {
    id: webhook.scheduleId,
    documentJson: JSON.stringify(webhook),
    secret: token,
  });
}

export function deleteAutomationWebhook(
  storage: DurableObjectStorage,
  scheduleId: string,
) {
  workspaceScheduleWebhooksDeleteRouteScheduleWebhooks(storage, scheduleId);
  workspaceWebhookEventsDeleteEvents(storage, scheduleId);
}

const keptEvents = 3;

/** The latest deliveries, newest first, whether or not they started a run. */
export function latestWebhookEvents(
  storage: DurableObjectStorage,
  scheduleId: string,
) {
  return workspaceWebhookEventsFindLatestEvents<{
    received_at: number;
    input_json: string;
  }>(storage, scheduleId, keptEvents).map((row) => {
    const input: unknown = JSON.parse(row.input_json);
    return automationWebhookEventSchema.parse({
      receivedAt: row.received_at,
      input,
    });
  });
}

function recordWebhookEvent(
  storage: DurableObjectStorage,
  scheduleId: string,
  input: JsonObject,
  receivedAt: number,
) {
  workspaceWebhookEventsInsertEvent(storage, {
    webhookId: scheduleId,
    receivedAt,
    inputJson: JSON.stringify(input),
  });
  const oldestKept = latestWebhookEvents(storage, scheduleId).at(-1);
  if (oldestKept)
    workspaceWebhookEventsDeleteEvents(
      storage,
      scheduleId,
      oldestKept.receivedAt,
    );
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/=+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}

async function sha256Hex(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
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
  const origin =
    request.headers.get("x-chief-public-origin") ?? env.RELAY_PUBLIC_URL;
  if (!origin) throw new Error("The relay public URL is unavailable.");
  const present = (
    webhook: StoredWebhook,
    token: string,
    sealedSigningSecret: string | null,
  ) =>
    automationWebhookSchema.parse({
      ...webhook,
      signed: Boolean(sealedSigningSecret),
      url: `${origin}/v1/workspaces/${encodeURIComponent(context.workspaceId)}/automations/${encodeURIComponent(webhook.scheduleId)}/webhook/${token}`,
    });
  // A saved automation keeps the access rules of its channel and team.
  const visible = (scheduleId: string) => {
    const schedule = readWorkspaceSchedule(storage, scheduleId)?.schedule;
    return (
      !schedule ||
      (channels.canReadConversation(
        schedule.conversationId,
        context.principal,
      ) &&
        [schedule.agentId, ...schedule.collaborators].every((agentId) =>
          canMessageAgent(channels, agentId, context.principal),
        ))
    );
  };
  if (operation === "webhooks-list")
    return json(
      automationWebhookListSchema.parse({
        webhooks: workspaceScheduleWebhooksFindListWebhooks<WebhookRow>(
          storage,
        ).flatMap((row) => {
          const webhook = storedWebhookSchema.safeParse(
            JSON.parse(row.document_json),
          );
          return webhook.success && visible(webhook.data.scheduleId)
            ? [present(webhook.data, row.secret, row.signing_secret)]
            : [];
        }),
      }),
    );

  const scheduleId = z
    .string()
    .min(1)
    .max(120)
    .parse(request.headers.get("x-chief-schedule-id"));
  const schedule = readWorkspaceSchedule(storage, scheduleId)?.schedule;
  if (schedule) {
    channels.requireChannelVisible(schedule.conversationId, context.principal);
    for (const agentId of [schedule.agentId, ...schedule.collaborators])
      requireAgentMessageAccess(channels, agentId, context.principal);
  }
  if (operation === "webhooks-events")
    return json(
      automationWebhookEventListSchema.parse({
        events: latestWebhookEvents(storage, scheduleId),
      }),
    );
  if (operation === "webhooks-revoke") {
    deleteAutomationWebhook(storage, scheduleId);
    return json(automationWebhookRevokedSchema.parse({ revoked: true }));
  }
  const command = automationWebhookRequestSchema.parse(
    await parseJson(request),
  );
  const current = readWebhook(storage, scheduleId);
  if (
    command.action === "set-signing-secret" ||
    command.action === "remove-signing-secret"
  ) {
    if (!current)
      throw new HttpError(
        404,
        "webhook_not_found",
        "Open the automation's trigger to get its URL first.",
      );
    let sealed: string | null = null;
    if (command.action === "set-signing-secret") {
      signingKeyBytes(command.secret);
      sealed = await sealSecret(
        env.RELAY_SECRET_KEY,
        signingPurpose,
        signingAdditionalData(context.workspaceId, scheduleId),
        command.secret,
      );
    }
    workspaceScheduleWebhooksUpdateSigningSecret(storage, {
      id: scheduleId,
      signingSecret: sealed,
    });
    return json(present(current.webhook, current.token, sealed));
  }
  if (current && command.action === "get")
    return json(
      present(current.webhook, current.token, current.sealedSigningSecret),
    );
  if (
    !current &&
    (workspaceScheduleWebhooksFindRouteScheduleWebhooksCount<{
      count: number;
    }>(storage)[0]?.count ?? 0) >= 250
  )
    throw new HttpError(
      409,
      "webhook_limit",
      "This workspace has 250 automation webhooks. Delete unused automations first.",
    );
  // Resetting replaces the token in place, so the old URL stops working at
  // once. A signing secret belongs to the sender and is kept.
  const token = newToken();
  const webhook: StoredWebhook = { scheduleId, createdAt: Date.now() };
  saveWebhook(storage, webhook, token);
  return json(present(webhook, token, current?.sealedSigningSecret ?? null));
}

/** Reads at most 64 KiB of UTF-8 without trusting Content-Length. */
export async function boundedWebhookBody(request: Request) {
  if (Number(request.headers.get("content-length")) > maximumBodyBytes)
    throw new HttpError(
      413,
      "webhook_body_too_large",
      "Webhook bodies must be at most 64 KiB.",
    );
  const reader = request.body?.getReader();
  if (!reader) return "";
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
      if (bytes > maximumBodyBytes)
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
    throw new HttpError(400, "webhook_encoding", "Send a UTF-8 body.");
  }
}

/** A JSON object, form fields, or nothing at all become the run's input. */
export function parseWebhookBody(
  contentType: string,
  body: string,
): JsonObject {
  if (body.trim() === "") return {};
  if (contentType.toLowerCase().includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(body));
  try {
    const parsed = jsonObjectSchema.safeParse(JSON.parse(body));
    if (parsed.success) return parsed.data;
  } catch {
    /* Reported below. */
  }
  throw new HttpError(
    400,
    "webhook_body_invalid",
    "Send a JSON object or form fields.",
  );
}

async function receiveDelivery(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const workspaceId = request.headers.get("x-chief-workspace-id") ?? "";
  const scheduleId = request.headers.get("x-chief-schedule-id") ?? "";
  const token = request.headers.get("x-chief-webhook-token") ?? "";
  let deliveryId = request.headers.get("x-chief-delivery-id");
  const contentType = request.headers.get("content-type") ?? "";
  const body = await request.text();
  const bodyHash = await sha256Hex(body);
  const initial = readWebhook(storage, scheduleId);
  if (!timingSafeEqual(initial?.token ?? "", token) || !initial)
    throw new HttpError(404, "webhook_not_found", "Webhook not found.");
  if (initial.sealedSigningSecret)
    deliveryId = await verifyWebhookSignature(
      await openSecret(
        env.RELAY_SECRET_KEY,
        signingPurpose,
        signingAdditionalData(workspaceId, scheduleId),
        initial.sealedSigningSecret,
      ),
      request.headers,
      body,
    );
  // No awaits from here on: the duplicate check and queueing the run happen
  // together, and a reset or new secret during verification refuses the event.
  const current = readWebhook(storage, scheduleId);
  if (
    !current ||
    current.token !== initial.token ||
    current.sealedSigningSecret !== initial.sealedSigningSecret
  )
    throw new HttpError(
      409,
      "webhook_changed",
      "This webhook changed while the event was checked. Send it again.",
    );
  const input = parseWebhookBody(contentType, body);
  // Senders that retry with a delivery id get the original response back.
  const previous = deliveryId
    ? workspaceWebhookDeliveriesFindReceiveDelivery<{
        run_id: string;
        body_hash: string;
      }>(storage, scheduleId, deliveryId)[0]
    : undefined;
  if (previous) {
    if (previous.body_hash !== bodyHash)
      throw new HttpError(
        409,
        "webhook_delivery_conflict",
        "This delivery id was already used with another body.",
      );
    return json(
      { runId: previous.run_id || null, duplicate: true },
      { status: 202 },
    );
  }
  const now = Date.now();
  const recent =
    workspaceWebhookDeliveriesFindReceiveDeliveryCount<{
      count: number;
    }>(storage, scheduleId, now - 60_000)[0]?.count ?? 0;
  if (recent >= 60)
    throw new HttpError(
      429,
      "webhook_rate_limit",
      "This webhook accepts at most 60 deliveries per minute.",
    );
  // Every event is kept briefly, so a draft can be mapped and tested against
  // real data before it is turned on.
  recordWebhookEvent(storage, scheduleId, input, now);
  const stored = readWorkspaceSchedule(storage, scheduleId);
  if (!stored?.approvedBy || stored.schedule.status !== "active") {
    workspaceWebhookDeliveriesInsertReceiveDelivery(storage, {
      webhookId: scheduleId,
      deliveryId: deliveryId ?? crypto.randomUUID(),
      bodyHash,
      runId: "",
      receivedAt: now,
    });
    saveWebhook(
      storage,
      { ...current.webhook, lastDeliveryAt: now },
      current.token,
    );
    return json({ runId: null, duplicate: false }, { status: 202 });
  }
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requireWorkspace(workspaceId);
  requireWorkspaceAdministrator(channels, stored.approvedBy);
  channels.requireChannelVisible(
    stored.schedule.conversationId,
    stored.approvedBy,
  );
  const run = queueScheduleRun(storage, stored.schedule, stored.approvedBy, {
    id: crypto.randomUUID(),
    source: "webhook",
    sourceId: scheduleId,
    scheduledAt: now,
    input,
  });
  workspaceWebhookDeliveriesInsertReceiveDelivery(storage, {
    webhookId: scheduleId,
    deliveryId: deliveryId ?? run.id,
    bodyHash,
    runId: run.id,
    receivedAt: now,
  });
  saveWebhook(
    storage,
    { ...current.webhook, lastDeliveryAt: now, lastRunId: run.id },
    current.token,
  );
  await wakeWorkspaceSchedules(storage);
  return json({ runId: run.id, duplicate: false }, { status: 202 });
}

/**
 * Checks a Standard Webhooks signature: HMAC-SHA256 over `id.timestamp.body`,
 * sent recently, as `v1,<base64>`. Returns the delivery id it covers.
 */
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
  const invalid = new HttpError(
    401,
    "webhook_signature_invalid",
    "A valid, recent webhook signature is required.",
  );
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(id) ||
    !/^\d{10}$/u.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    throw invalid;
  const key = await crypto.subtle.importKey(
    "raw",
    signingKeyBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  for (const signature of signatures) {
    if (!signature.startsWith("v1,")) continue;
    try {
      // crypto.subtle.verify compares in constant time.
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
      /* Try the next signature, without revealing why this one failed. */
    }
  }
  throw invalid;
}
