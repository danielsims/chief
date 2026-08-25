import { workspaceIdSchema } from "@chief/relay-contracts";

import { relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

function parseWorkspaceId(value: string | undefined) {
  return workspaceIdSchema.parse(decodeURIComponent(value ?? ""));
}

export async function routeWorkspaceSecrets(
  env: Env,
  request: Request,
  requestId: string,
  rawWorkspaceId: string | undefined,
) {
  const workspaceId = parseWorkspaceId(rawWorkspaceId);
  const authenticated = await authenticateRelayRequest(request, env);
  const principal = await authorizeWorkspace(env, {
    identity: authenticated.identity,
    requestId,
    workspaceId,
  });
  const forwarded = new Request(
    authenticated.request.url,
    authenticated.request,
  );
  const operation =
    request.method === "GET" && new URL(request.url).searchParams.has("name")
      ? "secret-get"
      : request.method === "GET"
        ? "secret-list"
        : request.method === "POST"
          ? "secret-set"
          : request.method === "DELETE"
            ? "secret-delete"
            : undefined;
  if (!operation) {
    return relayError(
      405,
      "method_not_allowed",
      "Method not allowed.",
      requestId,
    );
  }
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
    withTrustedContext(forwarded, {
      principal,
      requestId,
      workspaceId,
      conversationId: undefined,
    }),
  );
}
