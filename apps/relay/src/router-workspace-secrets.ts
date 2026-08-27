import { Effect } from "effect";

import { workspaceIdSchema } from "@chief/relay-contracts";

import { attempt, sync } from "./effect";
import { relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

function parseWorkspaceId(value: string | undefined) {
  return workspaceIdSchema.parse(decodeURIComponent(value ?? ""));
}

export function routeWorkspaceSecrets(
  env: Env,
  request: Request,
  requestId: string,
  rawWorkspaceId: string | undefined,
) {
  return Effect.gen(function* () {
    const workspaceId = yield* sync("relay.workspace_secret.scope", () =>
      parseWorkspaceId(rawWorkspaceId),
    );
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
    const headers = new Headers(authenticated.request.headers);
    headers.set("x-chief-internal-operation", operation);
    const forwarded = new Request(authenticated.request, { headers });
    return yield* attempt("relay.workspace_secret.forward", () =>
      env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
        withTrustedContext(forwarded, {
          principal,
          requestId,
          workspaceId,
          conversationId: undefined,
        }),
      ),
    );
  }).pipe(Effect.withSpan("relay.workspace_secret"));
}
