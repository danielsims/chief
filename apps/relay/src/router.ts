import {
  agentIdSchema,
  conversationIdSchema,
  createWorkspaceCommandSchema,
  relayDiscoverySchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";
import { createRelayOpenApiDocument } from "@chief/relay-contracts/openapi";

import { AuthenticationError, AuthorizationError } from "./auth";
import { isRelayAuthRequest, routeRelayAuth } from "./auth/routes";
import { bindDeviceIdentity } from "./device-identities";
import { relayDocsHtml } from "./docs";
import { HttpError, json, relayError } from "./http";
import {
  withTrustedAgentSocketTicket,
  withTrustedContext,
  withTrustedSocketTicket,
} from "./internal-context";
import {
  enforceEdgeRequestLimit,
  enforcePublicIdentityRequestLimit,
} from "./request-rate-limits";
import { routeAgentRequest } from "./router-agent-routes";
import { authenticateRelayRequest, requireAccountBinding } from "./router-auth";
import { routeChannelRequest } from "./router-channel-routes";
import {
  activeManagedWorkspace,
  authorizeConversation,
  authorizeWorkspace,
  claimWorkspace,
  claimWorkspaceInvite,
  createManagedWorkspace,
  createWorkspaceInvite,
  deleteManagedWorkspace,
  listManagedWorkspaces,
  previewWorkspaceInvite,
  routeWorkspaceLogs,
  switchManagedWorkspace,
} from "./workspace-authority";

const messageRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/messages(?:$|\/)/u;
const eventRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/events$/u;
const socketTicketRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/socket-tickets$/u;
const claimWorkspaceRoute = /^\/v1\/workspaces\/([^/]+)\/bootstrap\/claim$/u;
const workspaceLogsRoute = /^\/v1\/workspaces\/([^/]+)\/logs$/u;
const workspaceBrandProfileRoute =
  /^\/v1\/workspaces\/([^/]+)\/data\/brand-profile$/u;
const workspaceProspectsRoute = /^\/v1\/workspaces\/([^/]+)\/data\/prospects$/u;
const workspaceFilesRoute = /^\/v1\/workspaces\/([^/]+)\/files$/u;
const switchWorkspaceRoute = /^\/v1\/workspaces\/([^/]+)\/switch$/u;
const deleteWorkspaceRoute = /^\/v1\/workspaces\/([^/]+)$/u;
const workspaceInviteRoute = /^\/v1\/workspaces\/([^/]+)\/invites$/u;
const workspaceInvitePreviewRoute =
  /^\/v1\/workspaces\/([^/]+)\/invites\/preview$/u;
const workspaceInviteClaimRoute =
  /^\/v1\/workspaces\/([^/]+)\/invites\/claim$/u;

export async function routeRelayRequest(
  request: Request,
  env: Env,
  context: ExecutionContext,
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    await enforceEdgeRequestLimit(env, request);
    await enforcePublicIdentityRequestLimit(env, request);
    const url = new URL(request.url);
    if (isRelayAuthRequest(url)) return await routeRelayAuth(request, env);
    const publicResponse = routePublicRequest(request, url, env);
    if (publicResponse) return publicResponse;
    if (url.pathname === "/v1/identity/device" && request.method === "POST") {
      // Await inside the router boundary so malformed credentials become the
      // relay's stable JSON error envelope rather than an uncaught Worker 1101.
      return await bindDeviceIdentity(env, request);
    }

    const workspaceResponse = await routeWorkspaceRequest(
      env,
      request,
      requestId,
    );
    if (workspaceResponse) return workspaceResponse;
    const agentResponse = await routeAgentRequest(env, request, requestId);
    if (agentResponse) return agentResponse;
    const channelResponse = await routeChannelRequest(env, request, requestId);
    if (channelResponse) return channelResponse;

    const response = await routeConversationRequest(env, request, requestId);
    void context;
    return response;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return relayError(401, "unauthenticated", error.message, requestId);
    }
    if (error instanceof AuthorizationError) {
      return relayError(403, "forbidden", error.message, requestId);
    }
    if (error instanceof HttpError) {
      return relayError(
        error.status,
        error.code,
        error.message,
        requestId,
        error.details,
      );
    }
    return relayError(
      400,
      "invalid_request",
      "The relay request is invalid.",
      requestId,
    );
  }
}

function routePublicRequest(request: Request, url: URL, env: Env) {
  if (request.method !== "GET") return undefined;
  if (url.pathname === "/health") {
    return json({ ok: true, protocolVersion: 1 });
  }
  if (url.pathname === "/.well-known/chief-relay") {
    return json(discovery(url, env));
  }
  if (url.pathname === "/v1/openapi.json") {
    return json(createRelayOpenApiDocument(publicOrigin(url, env)));
  }
  if (url.pathname === "/docs") {
    return new Response(
      relayDocsHtml(`${publicOrigin(url, env)}/v1/openapi.json`),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  const invite = /^\/invite\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
  if (invite) {
    const workspaceId = parseWorkspaceId(invite[1]);
    const secret = decodeURIComponent(invite[2] ?? "");
    if (!/^[A-Za-z0-9_-]{43,128}$/u.test(secret)) {
      return relayError(
        404,
        "workspace_invite_not_found",
        "This invite is not valid.",
      );
    }
    return new Response(inviteLandingHtml(url.origin, workspaceId, secret), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return undefined;
}

function inviteLandingHtml(
  origin: string,
  workspaceId: string,
  secret: string,
) {
  const query = new URLSearchParams({
    relay: origin,
    workspace: workspaceId,
    code: secret,
  }).toString();
  const mobile = `chief-mobile://join?${query}`;
  const desktop = `chief-desktop://join?${query}`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join Chief</title><style>html{color-scheme:dark}body{margin:0;background:#080808;color:#f5f5f5;font:15px -apple-system,BlinkMacSystemFont,sans-serif;min-height:100vh;display:grid;place-items:center}.card{width:min(360px,calc(100vw - 40px));padding:28px;border:1px solid #292929;border-radius:24px;background:#111}h1{font-size:26px;margin:0 0 8px}p{color:#aaa;line-height:1.5;margin:0 0 22px}a{display:block;text-align:center;text-decoration:none;color:#080808;background:#f5f5f5;padding:13px;border-radius:999px;font-weight:650}a+a{margin-top:10px;color:#eee;background:#242424}</style></head><body><main class="card"><h1>Join this Chief workspace</h1><p>Open the invitation in the Chief app on this device.</p><a id="primary" href="${mobile}">Open Chief</a><a href="${desktop}">Open Chief for desktop</a></main><script>const mobile=${JSON.stringify(mobile)};const desktop=${JSON.stringify(desktop)};const target=/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)?mobile:desktop;document.getElementById('primary').href=target;location.href=target;</script></body></html>`;
}

async function routeWorkspaceRequest(
  env: Env,
  request: Request,
  requestId: string,
) {
  const url = new URL(request.url);
  const invitePreview = workspaceInvitePreviewRoute.exec(url.pathname);
  if (invitePreview && request.method === "POST") {
    return previewWorkspaceInvite(
      env,
      request,
      parseWorkspaceId(invitePreview[1]),
    );
  }
  if (url.pathname === "/v1/workspaces") {
    if (request.method !== "GET" && request.method !== "POST") return undefined;
    const authenticated = await authenticateRelayRequest(request, env);
    requireAccountBinding(env, authenticated.bound);
    if (request.method === "GET") {
      return listManagedWorkspaces(env, authenticated.identity);
    }
    const command = createWorkspaceCommandSchema.parse(
      await authenticated.request.json(),
    );
    return createManagedWorkspace(env, authenticated.identity, command);
  }
  if (url.pathname === "/v1/me/workspace" && request.method === "GET") {
    const authenticated = await authenticateRelayRequest(request, env);
    requireAccountBinding(env, authenticated.bound);
    return activeManagedWorkspace(env, authenticated.identity);
  }
  const deletion = deleteWorkspaceRoute.exec(url.pathname);
  if (deletion && request.method === "DELETE") {
    const workspaceId = parseWorkspaceId(deletion[1]);
    const authenticated = await authenticateRelayRequest(request, env);
    requireAccountBinding(env, authenticated.bound);
    return deleteManagedWorkspace(
      env,
      authenticated.identity,
      workspaceId,
      requestId,
    );
  }
  const inviteClaim = workspaceInviteClaimRoute.exec(url.pathname);
  if (inviteClaim && request.method === "POST") {
    const workspaceId = parseWorkspaceId(inviteClaim[1]);
    const authenticated = await authenticateRelayRequest(request, env);
    requireAccountBinding(env, authenticated.bound);
    return claimWorkspaceInvite(env, authenticated.request, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
  }
  const inviteCreate = workspaceInviteRoute.exec(url.pathname);
  if (inviteCreate && request.method === "POST") {
    const workspaceId = parseWorkspaceId(inviteCreate[1]);
    const authenticated = await authenticateRelayRequest(request, env);
    requireAccountBinding(env, authenticated.bound);
    const principal = await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    return createWorkspaceInvite(env, authenticated.request, {
      principal,
      requestId,
      workspaceId,
    });
  }
  const switched = switchWorkspaceRoute.exec(url.pathname);
  if (switched && request.method === "POST") {
    const workspaceId = parseWorkspaceId(switched[1]);
    const authenticated = await authenticateRelayRequest(request, env);
    requireAccountBinding(env, authenticated.bound);
    return switchManagedWorkspace(env, authenticated.identity, workspaceId);
  }
  const claimed = claimWorkspaceRoute.exec(url.pathname);
  if (claimed && request.method === "POST") {
    const workspaceId = parseWorkspaceId(claimed[1]);
    const authenticated = await authenticateRelayRequest(request, env);
    return claimWorkspace(env, authenticated.request, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
  }
  const logs = workspaceLogsRoute.exec(url.pathname);
  if (logs) {
    if (request.method !== "GET" && request.method !== "POST") {
      return relayError(
        405,
        "method_not_allowed",
        "Method not allowed.",
        requestId,
      );
    }
    const workspaceId = parseWorkspaceId(logs[1]);
    const authenticated = await authenticateRelayRequest(request, env);
    await authorizeWorkspace(env, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
    return routeWorkspaceLogs(env, authenticated.request, {
      identity: authenticated.identity,
      requestId,
      workspaceId,
    });
  }
  return routeWorkspaceDataRequest(env, request, requestId, url);
}

async function routeWorkspaceDataRequest(
  env: Env,
  request: Request,
  requestId: string,
  url: URL,
): Promise<Response | undefined> {
  const brand = workspaceBrandProfileRoute.exec(url.pathname);
  const prospects = workspaceProspectsRoute.exec(url.pathname);
  const files = workspaceFilesRoute.exec(url.pathname);
  let rawWorkspaceId: string | undefined;
  let operation: string | undefined;
  if (brand && ["GET", "PUT"].includes(request.method)) {
    rawWorkspaceId = brand[1];
    operation = request.method === "GET" ? "data-brand-get" : "data-brand-save";
  } else if (prospects && ["GET", "POST"].includes(request.method)) {
    rawWorkspaceId = prospects[1];
    operation =
      request.method === "GET" ? "data-prospects-list" : "data-prospect-save";
  } else if (files && request.method === "GET") {
    rawWorkspaceId = files[1];
    operation = "data-files-list";
  }
  if (!operation) return undefined;
  const workspaceId = parseWorkspaceId(rawWorkspaceId);
  const authenticated = await authenticateRelayRequest(request, env);
  const principal = await authorizeWorkspace(env, {
    identity: authenticated.identity,
    requestId,
    workspaceId,
  });
  const body =
    request.method === "GET" ? undefined : await authenticated.request.text();
  const workspace = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId));
  return workspace.fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "x-chief-internal-operation": operation,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body,
      }),
      { principal, requestId, workspaceId },
    ),
  );
}

async function routeConversationRequest(
  env: Env,
  request: Request,
  requestId: string,
) {
  const url = new URL(request.url);
  const connect = url.pathname === "/v1/connect";
  const match =
    messageRoute.exec(url.pathname) ??
    eventRoute.exec(url.pathname) ??
    socketTicketRoute.exec(url.pathname);
  if (!match && !connect) {
    return relayError(404, "not_found", "Relay route not found.", requestId);
  }
  if (
    connect &&
    (request.method !== "GET" || request.headers.get("upgrade") !== "websocket")
  ) {
    return relayError(
      426,
      "websocket_required",
      "The live relay endpoint requires a WebSocket upgrade.",
      requestId,
    );
  }
  const workspaceId = workspaceIdSchema.parse(
    connect
      ? url.searchParams.get("workspaceId")
      : decodeURIComponent(match?.[1] ?? ""),
  );
  if (connect) {
    return connectLiveSocket(env, request, requestId, workspaceId, url);
  }
  const conversationId = conversationIdSchema.parse(
    decodeURIComponent(match?.[2] ?? ""),
  );
  const authenticated = await authenticateRelayRequest(request, env);
  const principal = await authorizeWorkspace(env, {
    identity: authenticated.identity,
    requestId,
    workspaceId,
  });
  await authorizeConversation(env, {
    principal,
    requestId,
    workspaceId,
    conversationId,
    permission: conversationPermission(authenticated.request),
  });
  return conversationStub(env, workspaceId, conversationId).fetch(
    withTrustedContext(authenticated.request, {
      principal,
      requestId,
      workspaceId,
      conversationId,
    }),
  );
}

function conversationPermission(
  request: Request,
): "messages.read" | "messages.send" | "messages.manage" {
  if (request.method === "GET") return "messages.read";
  const path = new URL(request.url).pathname;
  if (path.endsWith("/edit") || request.method === "DELETE") {
    return "messages.manage";
  }
  return "messages.send";
}

async function connectLiveSocket(
  env: Env,
  request: Request,
  requestId: string,
  workspaceId: ReturnType<typeof workspaceIdSchema.parse>,
  url: URL,
) {
  const ticket = url.searchParams.get("ticket") ?? "";
  if (ticket.length < 43 || ticket.length > 128) {
    return relayError(
      401,
      "invalid_socket_ticket",
      "The socket ticket is invalid or expired.",
      requestId,
    );
  }
  const requestedAgentId = url.searchParams.get("agentId");
  const requestedConversationId = url.searchParams.get("conversationId");
  if (requestedAgentId && requestedConversationId) {
    return relayError(
      400,
      "ambiguous_socket_scope",
      "A live connection must select one conversation or one agent mailbox.",
      requestId,
    );
  }
  if (requestedAgentId) {
    const agentId = agentIdSchema.parse(requestedAgentId);
    const stub = env.AGENTS.get(
      env.AGENTS.idFromName(`${workspaceId}:${agentId}`),
    );
    return stub.fetch(
      withTrustedAgentSocketTicket(request, {
        ticket,
        requestId,
        workspaceId,
        agentId,
      }),
    );
  }
  const conversationId = conversationIdSchema.parse(requestedConversationId);
  return conversationStub(env, workspaceId, conversationId).fetch(
    withTrustedSocketTicket(request, {
      ticket,
      requestId,
      workspaceId,
      conversationId,
    }),
  );
}

function conversationStub(
  env: Env,
  workspaceId: string,
  conversationId: string,
) {
  return env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${workspaceId}:${conversationId}`),
  );
}

function discovery(url: URL, env: Env) {
  const origin = publicOrigin(url, env);
  return relayDiscoverySchema.parse({
    protocol: "chief-relay",
    protocolVersion: 1,
    deployment: env.RELAY_DEPLOYMENT,
    apiBaseUrl: `${origin}/v1`,
    websocketUrl: `${origin.replace(/^http/u, "ws")}/v1/connect`,
    openApiUrl: `${origin}/v1/openapi.json`,
    capabilities: [
      "workspaces",
      "conversations",
      "durable-agents",
      "projects",
      "artifacts",
      "logs",
    ],
    authentication: {
      scheme: "NIP-98",
      signingAlgorithm: "secp256k1-schnorr",
    },
  });
}

function parseWorkspaceId(value: string | undefined) {
  return workspaceIdSchema.parse(decodeURIComponent(value ?? ""));
}

function publicOrigin(url: URL, env: Env) {
  return (env.RELAY_PUBLIC_URL ?? url.origin).replace(/\/$/u, "");
}
