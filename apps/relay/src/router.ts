import type { AuthenticatedIdentity } from "@chief/relay-contracts";
import {
  agentIdSchema,
  conversationIdSchema,
  createWorkspaceCommandSchema,
  relayDiscoverySchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";
import { createRelayOpenApiDocument } from "@chief/relay-contracts/openapi";

import {
  AuthenticationError,
  AuthorizationError,
  RelayAuthenticator,
} from "./auth";
import { relayDocsHtml } from "./docs";
import { HttpError, json, relayError } from "./http";
import {
  withTrustedContext,
  withTrustedSocketTicket,
} from "./internal-context";
import {
  activeManagedWorkspace,
  authorizeWorkspace,
  claimWorkspace,
  createManagedWorkspace,
  routeAgentJob,
  routeAgentMessage,
  routeWorkspaceLogs,
} from "./workspace-authority";

const messageRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/messages$/u;
const eventRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/events$/u;
const socketTicketRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/socket-tickets$/u;
const claimWorkspaceRoute = /^\/v1\/workspaces\/([^/]+)\/bootstrap\/claim$/u;
const workspaceLogsRoute = /^\/v1\/workspaces\/([^/]+)\/logs$/u;
const agentJobsRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/jobs\/(claim|complete)$/u;
const agentMessageRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/messages$/u;
const connectRoute = "/v1/connect";
const createWorkspaceRoute = "/v1/workspaces";
const activeWorkspaceRoute = "/v1/me/workspace";

/**
 * Authenticate a request with NIP-98, buffering POST bodies so the signed
 * `payload` tag can be verified against the actual body. Returns the identity
 * and a re-created Request whose body is readable by the route handler.
 */
async function authenticate(
  request: Request,
): Promise<{ identity: AuthenticatedIdentity; request: Request }> {
  let body: string | null | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.text();
  }
  const identity = await new RelayAuthenticator().authenticate(request, body);
  if (body === undefined) return { identity, request };
  return {
    identity,
    request: new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    }),
  };
}

export async function routeRelayRequest(
  request: Request,
  env: Env,
  context: ExecutionContext,
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, protocolVersion: 1 });
    }
    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/chief-relay"
    ) {
      return json(discovery(url, env));
    }
    if (request.method === "GET" && url.pathname === "/v1/openapi.json") {
      return json(createRelayOpenApiDocument(publicOrigin(url, env)));
    }
    if (request.method === "GET" && url.pathname === "/docs") {
      return new Response(
        relayDocsHtml(`${publicOrigin(url, env)}/v1/openapi.json`),
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    if (url.pathname === createWorkspaceRoute && request.method === "POST") {
      const { identity, request: authed } = await authenticate(request);
      request = authed;
      const command = createWorkspaceCommandSchema.parse(await request.json());
      return await createManagedWorkspace(env, identity, command);
    }
    if (url.pathname === activeWorkspaceRoute && request.method === "GET") {
      const { identity, request: authed } = await authenticate(request);
      request = authed;
      return await activeManagedWorkspace(env, identity);
    }

    const claimMatch = claimWorkspaceRoute.exec(url.pathname);
    if (claimMatch && request.method === "POST") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(claimMatch[1] ?? ""),
      );
      const { identity, request: authed } = await authenticate(request);
      request = authed;
      return await claimWorkspace(env, request, {
        identity,
        requestId,
        workspaceId,
      });
    }

    const logsMatch = workspaceLogsRoute.exec(url.pathname);
    if (logsMatch) {
      if (request.method !== "GET" && request.method !== "POST") {
        return relayError(
          405,
          "method_not_allowed",
          "Method not allowed.",
          requestId,
        );
      }
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(logsMatch[1] ?? ""),
      );
      const { identity, request: authed } = await authenticate(request);
      request = authed;
      await authorizeWorkspace(env, { identity, requestId, workspaceId });
      return await routeWorkspaceLogs(env, request, {
        identity,
        requestId,
        workspaceId,
      });
    }

    const agentMsgMatch = agentMessageRoute.exec(url.pathname);
    if (agentMsgMatch && request.method === "POST") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(agentMsgMatch[1] ?? ""),
      );
      const agentId = agentIdSchema.parse(
        decodeURIComponent(agentMsgMatch[2] ?? ""),
      );
      const { identity, request: authed } = await authenticate(request);
      request = authed;
      const principal = await authorizeWorkspace(env, {
        identity,
        requestId,
        workspaceId,
      });
      return await routeAgentMessage(env, request, {
        owner: principal,
        requestId,
        workspaceId,
        agentId,
      });
    }

    const jobMatch = agentJobsRoute.exec(url.pathname);
    if (jobMatch && request.method === "POST") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(jobMatch[1] ?? ""),
      );
      const agentId = agentIdSchema.parse(
        decodeURIComponent(jobMatch[2] ?? ""),
      );
      const operation = jobMatch[3] === "complete" ? "complete" : "claim";
      const { identity, request: authed } = await authenticate(request);
      request = authed;
      const principal = await authorizeWorkspace(env, {
        identity,
        requestId,
        workspaceId,
      });
      return await routeAgentJob(env, request, {
        principal,
        requestId,
        workspaceId,
        agentId,
        operation,
      });
    }

    const connect = url.pathname === connectRoute;
    const match =
      messageRoute.exec(url.pathname) ??
      eventRoute.exec(url.pathname) ??
      socketTicketRoute.exec(url.pathname);
    if (!match && !connect)
      return relayError(404, "not_found", "Relay route not found.", requestId);
    if (
      connect &&
      (request.method !== "GET" ||
        request.headers.get("upgrade") !== "websocket")
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
    const conversationId = conversationIdSchema.parse(
      connect
        ? url.searchParams.get("conversationId")
        : decodeURIComponent(match?.[2] ?? ""),
    );
    if (connect) {
      const ticket = url.searchParams.get("ticket") ?? "";
      if (ticket.length < 43 || ticket.length > 128) {
        return relayError(
          401,
          "invalid_socket_ticket",
          "The socket ticket is invalid or expired.",
          requestId,
        );
      }
      const stub = conversationStub(env, workspaceId, conversationId);
      return await stub.fetch(
        withTrustedSocketTicket(request, {
          ticket,
          requestId,
          workspaceId,
          conversationId,
        }),
      );
    }
    const { identity, request: authed } = await authenticate(request);
    request = authed;
    const principal = await authorizeWorkspace(env, {
      identity,
      requestId,
      workspaceId,
    });

    const stub = conversationStub(env, workspaceId, conversationId);
    const trusted = withTrustedContext(request, {
      principal,
      requestId,
      workspaceId,
      conversationId,
    });
    const response = await stub.fetch(trusted);
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
      "logs",
    ],
    authentication: {
      scheme: "NIP-98",
      signingAlgorithm: "secp256k1-schnorr",
    },
  });
}

function publicOrigin(url: URL, env: Env) {
  return (env.RELAY_PUBLIC_URL ?? url.origin).replace(/\/$/u, "");
}
