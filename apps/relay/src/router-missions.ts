import { workspaceIdSchema } from "@chief/relay-contracts";

import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

export async function routeMissionRequest(
  env: Env,
  request: Request,
  requestId: string,
) {
  const match =
    /^\/v1\/workspaces\/([^/]+)\/missions(?:\/([^/]+)\/(experiments|status))?$/u.exec(
      new URL(request.url).pathname,
    );
  if (!match) return undefined;
  const operation = !match[2]
    ? request.method === "GET"
      ? "missions-list"
      : request.method === "POST"
        ? "missions-create"
        : null
    : request.method === "POST"
      ? match[3] === "experiments"
        ? "missions-experiment"
        : "missions-status"
      : null;
  if (!operation) return new Response(null, { status: 405 });
  const workspaceId = workspaceIdSchema.parse(
    decodeURIComponent(match[1] ?? ""),
  );
  const authenticated = await authenticateRelayRequest(request, env);
  const principal = await authorizeWorkspace(env, {
    identity: authenticated.identity,
    workspaceId,
    requestId,
  });
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": operation,
          "x-chief-mission-id": decodeURIComponent(match[2] ?? ""),
        },
        body:
          request.method === "GET"
            ? undefined
            : await authenticated.request.text(),
      }),
      { principal, workspaceId, requestId },
    ),
  );
}
