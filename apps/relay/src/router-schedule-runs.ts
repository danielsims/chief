import { workspaceIdSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { publicOrigin } from "./relay-discovery";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";
import {
  boundedWebhookBody,
  webhookTokenPattern,
} from "./workspace-schedule-webhooks";

export async function routeScheduleRunRequest(
  env: Env,
  request: Request,
  requestId: string,
) {
  const url = new URL(request.url);
  const hooks = /^\/v1\/workspaces\/([^/]+)\/webhooks$/u.exec(url.pathname);
  const hook =
    /^\/v1\/workspaces\/([^/]+)\/schedules\/([^/]+)\/webhook(\/events)?$/u.exec(
      url.pathname,
    );
  const delivery =
    /^\/v1\/workspaces\/([^/]+)\/automations\/([^/]+)\/webhook\/([^/]+)$/u.exec(
      url.pathname,
    );
  const runs =
    /^\/v1\/workspaces\/([^/]+)\/schedules\/([^/]+)\/runs(?:\/([^/]+)\/actions)?$/u.exec(
      url.pathname,
    );
  const report =
    /^\/v1\/workspaces\/([^/]+)\/schedule-runs\/(report|collaborators)$/u.exec(
      url.pathname,
    );
  if (!hooks && !hook && !delivery && !runs && !report) return undefined;
  const workspaceId = workspaceIdSchema.parse(
    decodeURIComponent(
      (hooks ?? hook ?? delivery ?? runs ?? report)?.[1] ?? "",
    ),
  );
  const scheduleId = (hook ?? delivery ?? runs)?.[2];
  const operation = report
    ? report[2] === "collaborators"
      ? "schedules-runs-add-collaborator"
      : "schedules-runs-report"
    : delivery
      ? "webhooks-deliver"
      : hooks
        ? "webhooks-list"
        : hook
          ? hook[3]
            ? "webhooks-events"
            : request.method === "DELETE"
              ? "webhooks-revoke"
              : "webhooks-issue"
          : runs?.[3]
            ? "schedules-runs-action"
            : "schedules-runs-list";
  const method =
    operation.endsWith("-list") || operation === "webhooks-events"
      ? "GET"
      : operation === "webhooks-revoke"
        ? "DELETE"
        : "POST";
  if (request.method !== method)
    return new Response(null, { status: 405, headers: { allow: method } });
  const headers = new Headers({
    "x-chief-internal-operation": operation,
    "x-chief-workspace-id": workspaceId,
    "x-chief-public-origin": publicOrigin(request, url, env),
    "content-type": "application/json",
    ...(scheduleId
      ? { "x-chief-schedule-id": decodeURIComponent(scheduleId) }
      : undefined),
    ...(runs?.[3]
      ? { "x-chief-run-id": decodeURIComponent(runs[3]) }
      : undefined),
  });
  const workspace = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId));
  if (delivery) {
    // The token in the path is the credential; the sender is not signed in.
    // Malformed tokens are refused here, without waking the workspace.
    const token = delivery[3] ?? "";
    if (!webhookTokenPattern.test(token))
      throw new HttpError(404, "webhook_not_found", "Webhook not found.");
    headers.set("x-chief-webhook-token", token);
    headers.set("content-type", request.headers.get("content-type") ?? "");
    const deliveryId =
      request.headers.get("webhook-id") ??
      request.headers.get("idempotency-key");
    if (deliveryId && deliveryId.length <= 256)
      headers.set("x-chief-delivery-id", deliveryId);
    // Standard Webhooks headers, checked when the automation has a secret.
    for (const name of [
      "webhook-id",
      "webhook-timestamp",
      "webhook-signature",
    ]) {
      const value = request.headers.get(name);
      if (value && value.length <= 1024) headers.set(name, value);
    }
    return workspace.fetch(
      new Request("https://workspace.internal", {
        method: "POST",
        headers,
        body: await boundedWebhookBody(request),
      }),
    );
  }
  const authenticated = await authenticateRelayRequest(request, env);
  const principal = await authorizeWorkspace(env, {
    identity: authenticated.identity,
    workspaceId,
    requestId,
  });
  return workspace.fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers,
        body:
          method === "POST" ? await authenticated.request.text() : undefined,
      }),
      { principal, workspaceId, requestId },
    ),
  );
}
