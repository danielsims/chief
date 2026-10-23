import { Effect } from "effect";

import { attempt } from "./effect";
import { withTrustedContext } from "./internal-context";
import { parseWorkspaceId } from "./router-agent-route-support";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const pairingsRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/pairings$/u;
const claimRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/claim$/u;
const ticketRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/socket-tickets$/u;
const pairedRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/paired$/u;
const pairedMachineRoute =
  /^\/v1\/workspaces\/([^/]+)\/machines\/paired\/([^/]+)$/u;

/**
 * Paired machines. A member adds and removes their own; a machine claims its
 * pairing code and fetches socket tickets with its own key, not a person's
 * session, so those two routes don't sign anyone in.
 */
export function routeWorkspaceMachines(
  env: Env,
  request: Request,
  requestId: string,
  url: URL,
) {
  return Effect.gen(function* () {
    const workspaceFor = (raw: string | undefined) =>
      env.WORKSPACES.get(env.WORKSPACES.idFromName(parseWorkspaceId(raw)));

    const claim = claimRoute.exec(url.pathname);
    const ticket = ticketRoute.exec(url.pathname);
    if ((claim || ticket) && request.method === "POST") {
      const match = claim ?? ticket;
      return yield* attempt("relay.machines.machine", () =>
        workspaceFor(match?.[1]).fetch(
          new Request("https://workspace.internal/machines", {
            method: "POST",
            headers: {
              "x-chief-internal-operation": claim
                ? "machine-pairing-claim"
                : "machine-ticket",
              "content-type": "application/json",
              authorization: request.headers.get("authorization") ?? "",
            },
            body: claim ? request.body : null,
          }),
        ),
      );
    }

    const pairings = pairingsRoute.exec(url.pathname);
    const paired = pairedRoute.exec(url.pathname);
    const pairedMachine = pairedMachineRoute.exec(url.pathname);
    const member =
      (pairings !== null && request.method === "POST") ||
      (paired !== null && request.method === "GET") ||
      (pairedMachine !== null && request.method === "DELETE");
    if (!member) return undefined;
    const workspaceId = parseWorkspaceId(
      (pairings ?? paired ?? pairedMachine)?.[1],
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
    const operation = pairings
      ? "machine-pairing-create"
      : paired
        ? "machine-list"
        : "machine-revoke";
    return yield* attempt("relay.machines.member", () =>
      workspaceFor(workspaceId).fetch(
        withTrustedContext(
          new Request("https://workspace.internal/machines", {
            method: "POST",
            headers: {
              "x-chief-internal-operation": operation,
              "content-type": "application/json",
            },
            body: JSON.stringify(
              pairedMachine ? { machineId: pairedMachine[2] } : {},
            ),
          }),
          { principal, requestId, workspaceId },
        ),
      ),
    );
  });
}
