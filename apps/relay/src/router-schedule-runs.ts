import { workspaceIdSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { publicOrigin } from "./relay-discovery";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";
import { boundedWebhookBody } from "./workspace-schedule-webhooks";

export async function routeScheduleRunRequest(
  env: Env,
  request: Request,
  requestId: string,
) {
  const url = new URL(request.url);
  const hooks =
    /^\/v1\/workspaces\/([^/]+)\/webhooks(?:\/([^/]+)\/(actions|deliveries))?$/u.exec(
      url.pathname,
    );
  const runs =
    /^\/v1\/workspaces\/([^/]+)\/schedules\/([^/]+)\/runs(?:\/([^/]+)\/actions)?$/u.exec(
      url.pathname,
    );
  const report = /^\/v1\/workspaces\/([^/]+)\/schedule-runs\/report$/u.exec(
    url.pathname,
  );
  if (!hooks && !runs && !report) return undefined;
  const workspaceId = workspaceIdSchema.parse(
    decodeURIComponent((hooks ?? runs ?? report)?.[1] ?? ""),
  );
  const delivery = hooks?.[3] === "deliveries";
  const operation = report
    ? "schedules-runs-report"
    : delivery
      ? "webhooks-deliver"
      : hooks
        ? hooks[2]
          ? "webhooks-action"
          : request.method === "GET"
            ? "webhooks-list"
            : "webhooks-create"
        : runs?.[3]
          ? "schedules-runs-action"
          : "schedules-runs-list";
  const method = operation.endsWith("-list") ? "GET" : "POST";
  if (request.method !== method)
    return new Response(null, { status: 405, headers: { allow: method } });
  const headers = new Headers({
    "x-chief-internal-operation": operation,
    "x-chief-workspace-id": workspaceId,
    "x-chief-public-origin": publicOrigin(request, url, env),
    "content-type": "application/json",
    ...(hooks?.[2]
      ? { "x-chief-webhook-id": decodeURIComponent(hooks[2]) }
      : undefined),
    ...(runs?.[2]
      ? { "x-chief-schedule-id": decodeURIComponent(runs[2]) }
      : undefined),
    ...(runs?.[3]
      ? { "x-chief-run-id": decodeURIComponent(runs[3]) }
      : undefined),
  });
  const workspace = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId));
  if (delivery) {
    for (const name of [
      "webhook-id",
      "webhook-timestamp",
      "webhook-signature",
    ]) {
      const value = request.headers.get(name);
      if (!value || value.length > 1024)
        throw new HttpError(
          401,
          "webhook_signature_missing",
          "Send the webhook signature headers.",
        );
      headers.set(name, value);
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
        body: method === "GET" ? undefined : await authenticated.request.text(),
      }),
      { principal, workspaceId, requestId },
    ),
  );
}
