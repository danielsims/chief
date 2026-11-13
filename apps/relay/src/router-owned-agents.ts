import type { Principal, WorkspaceId } from "@chief/relay-contracts";
import { workspaceIdSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import {
  ownedAgentCredentialHeader,
  verifyOwnedAgentCredential,
} from "./owned-agent-credential";
import {
  OWNED_AGENT_GATEWAY_SERVICE,
  OWNED_AGENT_ID_HEADER,
  OWNED_AGENT_ORIGIN_HEADER,
  OWNED_AGENT_PUBKEY_HEADER,
} from "./owned-agent-service";
import { publicOrigin } from "./relay-discovery";
import { authenticateRelayRequest, requireAccountBinding } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const memberRoute =
  /^\/v1\/workspaces\/([^/]+)\/owned-agents(?:\/(codes|requests)(?:\/([^/]+)\/(approve|deny))?|\/([^/]+)(?:\/(revoke|channels)(?:\/([^/]+))?)?)?$/u;
const agentRoute =
  /^\/v1\/workspaces\/([^/]+)\/agent-connect\/(connect|token|challenge|credential|self|messages|leave)$/u;

export async function routeOwnedAgents(
  env: Env,
  request: Request,
  requestId: string,
) {
  const url = new URL(request.url);
  if (url.pathname === "/connect" && request.method === "GET")
    return new Response(
      `Chief agent connection

You can connect from a local device or your own cloud host (including Grokbot, Muse or another independent agent). Use the complete invitation link the human supplied, including its #fragment. The fragment is intentionally not sent to this page.

1. If chief-machine is missing, the official installation scripts are:
   macOS/Linux: ${publicOrigin(request, url, env)}/install/machine
   Windows: ${publicOrigin(request, url, env)}/install/machine.ps1
   Install the CLI according to your environment's permissions. Its agent --help must list connect. An older guest-only CLI is incompatible; do not fall back to guest access.
2. Request access using your own name and provider, for example:
   chief-machine agent connect --link '<complete invitation link>' --name chatgpt --provider chatgpt
   Providers: chatgpt, claude, grok, muse, other. Use other for any unlisted host.
3. Tell the human the verification code and that the request is waiting in Chief. Then run:
   chief-machine agent wait <binding-id>
   Do not claim to be connected until it confirms approval. No account credentials or human signing keys are needed.
4. Approval grants messaging in #general. The human may add other channels or revoke you at any time. Read your assigned channels with chief-machine agent messages <binding-id>. Post using chief-machine agent post <binding-id> <channel-id> [thread-id], with message text on stdin.

Connecting does not lend your machine, install a reply adapter or run background work. Independent hosts may separately configure and enable an adapter before chief-machine serve. If you cannot run the CLI, explain the limitation honestly.
`,
      {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      },
    );
  const setup =
    /^\/v1\/workspaces\/([^/]+)\/setup(?:\/(complete|welcome))?$/u.exec(
      url.pathname,
    );
  if (
    setup &&
    ["GET", "POST"].includes(request.method) &&
    (setup[2] !== "welcome" || request.method === "POST")
  ) {
    const authenticated = await authenticateRelayRequest(request, env);
    requireAccountBinding(env, authenticated.bound);
    const workspaceId = workspaceIdSchema.parse(setup[1]);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedContext(
        new Request("https://workspace.internal", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-chief-internal-operation":
              request.method === "GET"
                ? "setup-snapshot"
                : setup[2] === "welcome"
                  ? "start-welcome"
                  : "finish-setup",
          },
          body:
            request.method === "POST"
              ? await authenticated.request.text()
              : undefined,
        }),
        { principal, requestId, workspaceId },
      ),
    );
  }
  const member = memberRoute.exec(url.pathname);
  const external = agentRoute.exec(url.pathname);
  if (!member && !external) return null;
  const workspaceId = workspaceIdSchema.parse(
    decodeURIComponent(member?.[1] ?? external?.[1] ?? ""),
  );
  const authenticated = await authenticateRelayRequest(request, env);
  if (authenticated.identity.kind === "service")
    throw new HttpError(
      403,
      "signed_key_required",
      "A signed agent key is required.",
    );
  let principal: Principal;
  let operation: string;
  let agentId: string | null = null;
  if (member) {
    requireAccountBinding(env, authenticated.bound);
    principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    if (principal.kind !== "user")
      throw new HttpError(
        403,
        "members_only",
        "Only a workspace member can manage agents.",
      );
    const [, , group, id, decision, ownedId, action, channel] = member;
    operation =
      group === "codes" && request.method === "POST"
        ? "code-create"
        : group === "codes" && request.method === "DELETE"
          ? "code-invalidate"
          : group === "requests" && request.method === "GET" && !id
            ? "request-list"
            : group === "requests" &&
                id &&
                decision &&
                request.method === "POST"
              ? `request-${decision}`
              : ownedId && action === "revoke" && request.method === "POST"
                ? "revoke"
                : ownedId &&
                    action === "channels" &&
                    channel &&
                    ["PUT", "DELETE"].includes(request.method)
                  ? `channel-${request.method === "PUT" ? "add" : "remove"}`
                  : !group && !ownedId && request.method === "GET"
                    ? "list"
                    : "";
    if (id) url.searchParams.set("requestId", decodeURIComponent(id));
    if (ownedId) url.searchParams.set("agentId", decodeURIComponent(ownedId));
    if (channel)
      url.searchParams.set("conversationId", decodeURIComponent(channel));
  } else {
    const action = external?.[2] ?? "";
    const allowed = ["self", "messages"].includes(action)
      ? request.method === "GET" ||
        (action === "messages" && request.method === "POST")
      : request.method === "POST";
    if (!allowed)
      throw new HttpError(405, "method_not_allowed", "Method not allowed.");
    const pubkey = authenticated.identity.pubkey;
    agentId = request.headers.get(OWNED_AGENT_ID_HEADER);
    if (!["connect", "token", "challenge", "credential"].includes(action)) {
      const credential = await verifyOwnedAgentCredential(
        env,
        request.headers.get(ownedAgentCredentialHeader),
        { pubkey, workspaceId },
      );
      agentId = credential.agentId;
    }
    principal = {
      kind: "service",
      service: OWNED_AGENT_GATEWAY_SERVICE,
      workspaceId,
    };
    operation =
      action === "messages"
        ? request.method === "POST"
          ? "post"
          : "messages"
        : action;
  }
  if (!operation)
    throw new HttpError(405, "method_not_allowed", "Method not allowed.");
  const body =
    request.method === "GET" || request.method === "DELETE"
      ? "{}"
      : await authenticated.request.text();
  return forwardOwned(
    env,
    workspaceId,
    principal,
    requestId,
    operation,
    url.search,
    body,
    publicOrigin(request, url, env),
    authenticated.identity.pubkey,
    agentId,
  );
}
function forwardOwned(
  env: Env,
  workspaceId: WorkspaceId,
  principal: Principal,
  requestId: string,
  operation: string,
  search: string,
  body: string,
  origin: string,
  pubkey: string,
  agentId: string | null,
) {
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
    withTrustedContext(
      new Request(`https://workspace.internal/owned${search}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": `owned-agent-${operation}`,
          [OWNED_AGENT_ORIGIN_HEADER]: origin,
          [OWNED_AGENT_PUBKEY_HEADER]: pubkey,
          [OWNED_AGENT_ID_HEADER]: agentId ?? "",
        },
        body,
      }),
      { principal, requestId, workspaceId },
    ),
  );
}
