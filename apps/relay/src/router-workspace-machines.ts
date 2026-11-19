import { Effect } from "effect";

import { pairedMachineUpdateSchema } from "@chief/relay-contracts";

import { attempt } from "./effect";
import { withTrustedContext } from "./internal-context";
import { parseWorkspaceId } from "./router-agent-route-support";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const pairingsRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/pairings$/u;
const claimRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/claim$/u;
const ticketRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/socket-tickets$/u;
const streamRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/stream$/u;
const viewerTicketRoute =
  /^\/v1\/workspaces\/([^/]+)\/machines\/viewer-tickets$/u;
const pairedRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/paired$/u;
const pairedMachineRoute =
  /^\/v1\/workspaces\/([^/]+)\/machines\/paired\/([^/]+)$/u;
const browserStopRoute =
  /^\/v1\/workspaces\/([^/]+)\/machines\/browser-stops$/u;
const machineActivityRoute = /^\/v1\/workspaces\/([^/]+)\/machines\/activity$/u;

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
    const stream = streamRoute.exec(url.pathname);
    if ((claim || ticket || stream) && request.method === "POST") {
      const match = claim ?? ticket ?? stream;
      return yield* attempt("relay.machines.machine", () =>
        workspaceFor(match?.[1]).fetch(
          new Request("https://workspace.internal/machines", {
            method: "POST",
            headers: {
              "x-chief-internal-operation": claim
                ? "machine-pairing-claim"
                : stream
                  ? "machine-stream-setup"
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
    const viewerTicket = viewerTicketRoute.exec(url.pathname);
    const activity = machineActivityRoute.exec(url.pathname);
    const browserStop = browserStopRoute.exec(url.pathname);
    const member =
      (viewerTicket !== null && request.method === "POST") ||
      (browserStop !== null && request.method === "POST") ||
      (pairings !== null && request.method === "POST") ||
      (paired !== null && request.method === "GET") ||
      (pairedMachine !== null &&
        (request.method === "DELETE" || request.method === "PATCH")) ||
      (activity !== null && request.method === "GET");
    if (!member) return undefined;
    const workspaceId = parseWorkspaceId(
      (pairings ??
        paired ??
        pairedMachine ??
        viewerTicket ??
        activity ??
        browserStop)?.[1],
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
    const operation = viewerTicket
      ? "machine-viewer-ticket"
      : browserStop
        ? "machine-browser-stop"
        : activity
          ? "machine-activity-list"
          : pairings
            ? "machine-pairing-create"
            : paired
              ? "machine-list"
              : pairedMachine && request.method === "PATCH"
                ? "machine-set-enabled"
                : "machine-revoke";
    const toggle =
      pairedMachine && request.method === "PATCH"
        ? yield* attempt("relay.machines.update", async () =>
            pairedMachineUpdateSchema.parse(
              await authenticated.request.clone().json(),
            ),
          )
        : undefined;
    const body =
      viewerTicket ||
      browserStop ||
      (pairedMachine && request.method === "PATCH")
        ? pairedMachine
          ? JSON.stringify({
              ...toggle,
              machineId: pairedMachine[2],
            })
          : authenticated.request.body
        : JSON.stringify(pairedMachine ? { machineId: pairedMachine[2] } : {});
    return yield* attempt("relay.machines.member", () =>
      workspaceFor(workspaceId).fetch(
        withTrustedContext(
          new Request("https://workspace.internal/machines", {
            method: "POST",
            headers: {
              "x-chief-internal-operation": operation,
              "content-type": "application/json",
            },
            body,
          }),
          { principal, requestId, workspaceId },
        ),
      ),
    );
  });
}
