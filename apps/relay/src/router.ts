import {
  agentIdSchema,
  conversationIdSchema,
  createWorkspaceCommandSchema,
  relayDiscoverySchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";
import { createRelayOpenApiDocument } from "@chief/relay-contracts/openapi";

import { AuthenticationError, AuthorizationError } from "./auth";
import { bindDeviceIdentity } from "./device-identities";
import { relayDocsHtml } from "./docs";
import { HttpError, json, relayError } from "./http";
import {
  withTrustedAgentSocketTicket,
  withTrustedContext,
  withTrustedSocketTicket,
} from "./internal-context";
import { routeAgentRequest } from "./router-agent-routes";
import { authenticateRelayRequest, requireAccountBinding } from "./router-auth";
import { routeChannelRequest } from "./router-channel-routes";
import {
  activeManagedWorkspace,
  authorizeConversation,
  authorizeWorkspace,
  claimWorkspace,
  createManagedWorkspace,
  listManagedWorkspaces,
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

export async function routeRelayRequest(
  request: Request,
  env: Env,
  context: ExecutionContext,
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const url = new URL(request.url);
    const publicResponse = routePublicRequest(request, url, env);
    if (publicResponse) return publicResponse;
    if (url.pathname === "/v1/identity/device" && request.method === "POST") {
      return bindDeviceIdentity(env, request);
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
  return undefined;
}

async function routeWorkspaceRequest(
  env: Env,
  request: Request,
  requestId: string,
) {
  const url = new URL(request.url);
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
