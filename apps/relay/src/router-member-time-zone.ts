import { Effect } from "effect";

import { attempt } from "./effect";
import { withTrustedContext } from "./internal-context";
import { parseWorkspaceId } from "./router-agent-route-support";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const timeZoneRoute = /^\/v1\/workspaces\/([^/]+)\/members\/me\/time-zone$/u;

/** A member's app reports the time zone it's in. */
export function routeMemberTimeZone(
  env: Env,
  request: Request,
  requestId: string,
  url: URL,
) {
  return Effect.gen(function* () {
    const match = timeZoneRoute.exec(url.pathname);
    if (!match || request.method !== "PUT") return undefined;
    const workspaceId = parseWorkspaceId(match[1]);
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
    return yield* attempt("relay.members.time_zone", () =>
      env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
        withTrustedContext(
          new Request("https://workspace.internal/members/time-zone", {
            method: "POST",
            headers: {
              "x-chief-internal-operation": "member-time-zone-set",
              "content-type": "application/json",
            },
            body: authenticated.request.body,
          }),
          { principal, requestId, workspaceId },
        ),
      ),
    );
  });
}
