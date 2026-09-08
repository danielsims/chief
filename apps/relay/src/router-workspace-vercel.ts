import { Effect } from "effect";

import { workspaceIdSchema } from "@chief/relay-contracts";

import { attempt, sync } from "./effect";
import { relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const workspaceVercelRoute =
  /^\/v1\/workspaces\/([^/]+)\/vercel\/(connect|destinations|provision)$/u;

type VercelOperation = "connect" | "destinations" | "provision";

export function routeWorkspaceVercel(
  env: Env,
  request: Request,
  requestId: string,
) {
  return Effect.gen(function* () {
    const url = new URL(request.url);
    const matched = workspaceVercelRoute.exec(url.pathname);
    if (!matched) return undefined;
    const operation = parseWorkspaceVercelOperation(matched[2]);
    if (!operation) {
      return relayError(404, "not_found", "Route not found.", requestId);
    }
    const workspaceId = yield* sync("relay.workspace_vercel.scope", () =>
      workspaceIdSchema.parse(decodeURIComponent(matched[1] ?? "")),
    );
    const expectedMethod = operation === "destinations" ? "GET" : "POST";
    if (request.method !== expectedMethod) {
      return relayError(
        405,
        "method_not_allowed",
        "Method not allowed.",
        requestId,
      );
    }
    const authenticated = yield* attempt("relay.authenticate", () =>
      authenticateRelayRequest(request, env),
    );
    const principal = yield* attempt("relay.workspace.authorize", () =>
      authorizeWorkspace(env, {
        identity: authenticated.identity,
        requestId,
        workspaceId,
      }),
    );
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", `vercel-${operation}`);
    const forwarded = new Request(authenticated.request, { headers });
    return yield* attempt("relay.workspace_vercel.forward", () =>
      env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
        withTrustedContext(forwarded, {
          principal,
          requestId,
          workspaceId,
          conversationId: undefined,
        }),
      ),
    );
  }).pipe(Effect.withSpan("relay.workspace_vercel"));
}

function parseWorkspaceVercelOperation(
  value: string | undefined,
): VercelOperation | undefined {
  if (
    value === "connect" ||
    value === "destinations" ||
    value === "provision"
  ) {
    return value;
  }
  return undefined;
}
