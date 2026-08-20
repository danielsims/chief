import type { AuthenticatedIdentity } from "@chief/relay-contracts";
import {
  agentIdSchema,
  conversationIdSchema,
  createWorkspaceCommandSchema,
  relayDiscoverySchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";
import { createRelayOpenApiDocument } from "@chief/relay-contracts/openapi";

import { getAttachment, uploadAttachment } from "./attachments";
import {
  AuthenticationError,
  AuthorizationError,
  RelayAuthenticator,
} from "./auth";
import { bindDeviceIdentity, resolveDeviceIdentity } from "./device-identities";
import { relayDocsHtml } from "./docs";
import { HttpError, json, relayError } from "./http";
import {
  withTrustedAgentSocketTicket,
  withTrustedContext,
  withTrustedSocketTicket,
} from "./internal-context";
import {
  activeManagedWorkspace,
  authorizeConversation,
  authorizeWorkspace,
  claimWorkspace,
  createManagedWorkspace,
  listManagedWorkspaces,
  registerAgentKey,
  routeAgentJob,
  routeAgentMailboxTicket,
  routeChannelOperation,
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
const agentJobsRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/jobs\/(claim|complete)$/u;
const agentSocketTicketRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/socket-tickets$/u;
const agentKeysRoute = /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/keys$/u;
const agentConfigRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/config$/u;
const workspaceMembersRoute = /^\/v1\/workspaces\/([^/]+)\/members$/u;
const workspaceBrandProfileRoute =
  /^\/v1\/workspaces\/([^/]+)\/data\/brand-profile$/u;
const workspaceProspectsRoute = /^\/v1\/workspaces\/([^/]+)\/data\/prospects$/u;
const workspaceFilesRoute = /^\/v1\/workspaces\/([^/]+)\/files$/u;
const directStartRoute = /^\/v1\/workspaces\/([^/]+)\/directs$/u;
const channelListRoute = /^\/v1\/workspaces\/([^/]+)\/channels$/u;
const channelItemRoute = /^\/v1\/workspaces\/([^/]+)\/channels\/([^/]+)$/u;
const channelActionRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/([^/]+)\/(update|archive|unarchive|join|leave)$/u;
const channelMembersRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/([^/]+)\/members$/u;
const channelMembershipsRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/memberships$/u;
const channelMemberActionRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/([^/]+)\/members\/(add|remove)$/u;
const attachmentsUploadRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/attachments$/u;
const attachmentReadRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/attachments\/([^/]+)$/u;
const connectRoute = "/v1/connect";
const workspacesRoute = "/v1/workspaces";
const switchWorkspaceRoute = /^\/v1\/workspaces\/([^/]+)\/switch$/u;
const activeWorkspaceRoute = "/v1/me/workspace";
const bindDeviceIdentityRoute = "/v1/identity/device";

/**
 * Authenticate a request with NIP-98, buffering POST bodies so the signed
 * `payload` tag can be verified against the actual body. Returns the identity
 * and a re-created Request whose body is readable by the route handler.
 */
async function authenticate(
  request: Request,
  env: Env,
): Promise<{
  identity: AuthenticatedIdentity;
  request: Request;
  bound: boolean;
}> {
  let body: string | null | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.text();
  }
  const signedIdentity = new RelayAuthenticator().authenticate(request, body);
  const resolved = await resolveDeviceIdentity(env, signedIdentity);
  if ("response" in resolved) {
    throw new AuthenticationError("Device identity denied.");
  }
  const identity = resolved.identity;
  if (body === undefined) return { identity, request, bound: resolved.bound };
  return {
    identity,
    bound: resolved.bound,
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

    if (url.pathname === bindDeviceIdentityRoute && request.method === "POST") {
      return await bindDeviceIdentity(env, request);
    }

    if (url.pathname === workspacesRoute && request.method === "POST") {
      const {
        identity,
        request: authed,
        bound,
      } = await authenticate(request, env);
      requireAccountBinding(env, bound);
      request = authed;
      const command = createWorkspaceCommandSchema.parse(await request.json());
      return await createManagedWorkspace(env, identity, command);
    }
    if (url.pathname === workspacesRoute && request.method === "GET") {
      const {
        identity,
        request: authed,
        bound,
      } = await authenticate(request, env);
      requireAccountBinding(env, bound);
      request = authed;
      return await listManagedWorkspaces(env, identity);
    }
    if (url.pathname === activeWorkspaceRoute && request.method === "GET") {
      const {
        identity,
        request: authed,
        bound,
      } = await authenticate(request, env);
      requireAccountBinding(env, bound);
      request = authed;
      return await activeManagedWorkspace(env, identity);
    }

    const switchMatch = switchWorkspaceRoute.exec(url.pathname);
    if (switchMatch && request.method === "POST") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(switchMatch[1] ?? ""),
      );
      const {
        identity,
        request: authed,
        bound,
      } = await authenticate(request, env);
      requireAccountBinding(env, bound);
      request = authed;
      return await switchManagedWorkspace(env, identity, workspaceId);
    }

    const claimMatch = claimWorkspaceRoute.exec(url.pathname);
    if (claimMatch && request.method === "POST") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(claimMatch[1] ?? ""),
      );
      const { identity, request: authed } = await authenticate(request, env);
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
      const { identity, request: authed } = await authenticate(request, env);
      request = authed;
      await authorizeWorkspace(env, { identity, requestId, workspaceId });
      return await routeWorkspaceLogs(env, request, {
        identity,
        requestId,
        workspaceId,
      });
    }

    const brandProfileMatch = workspaceBrandProfileRoute.exec(url.pathname);
    if (brandProfileMatch && ["GET", "PUT"].includes(request.method)) {
      return await routeWorkspaceDataRequest(
        env,
        request,
        requestId,
        decodeURIComponent(brandProfileMatch[1] ?? ""),
        request.method === "GET" ? "data-brand-get" : "data-brand-save",
      );
    }
    const prospectsMatch = workspaceProspectsRoute.exec(url.pathname);
    if (prospectsMatch && ["GET", "POST"].includes(request.method)) {
      return await routeWorkspaceDataRequest(
        env,
        request,
        requestId,
        decodeURIComponent(prospectsMatch[1] ?? ""),
        request.method === "GET" ? "data-prospects-list" : "data-prospect-save",
      );
    }
    const filesMatch = workspaceFilesRoute.exec(url.pathname);
    if (filesMatch && request.method === "GET") {
      return await routeWorkspaceDataRequest(
        env,
        request,
        requestId,
        decodeURIComponent(filesMatch[1] ?? ""),
        "data-files-list",
      );
    }

    const agentKeysMatch = agentKeysRoute.exec(url.pathname);
    if (agentKeysMatch && request.method === "POST") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(agentKeysMatch[1] ?? ""),
      );
      const agentId = agentIdSchema.parse(
        decodeURIComponent(agentKeysMatch[2] ?? ""),
      );
      const { identity, request: authed } = await authenticate(request, env);
      request = authed;
      const principal = await authorizeWorkspace(env, {
        identity,
        requestId,
        workspaceId,
      });
      if (principal.kind !== "user" || principal.role !== "owner") {
        throw new AuthorizationError(
          "Only a workspace owner can register an agent key.",
        );
      }
      return await registerAgentKey(env, request, {
        owner: principal,
        requestId,
        workspaceId,
        agentId,
      });
    }

    const agentConfigMatch = agentConfigRoute.exec(url.pathname);
    if (agentConfigMatch) {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(agentConfigMatch[1] ?? ""),
      );
      const agentId = agentIdSchema.parse(
        decodeURIComponent(agentConfigMatch[2] ?? ""),
      );
      if (request.method !== "GET" && request.method !== "POST") {
        return relayError(
          405,
          "method_not_allowed",
          "Method not allowed.",
          requestId,
        );
      }
      const { identity, request: authed } = await authenticate(request, env);
      request = authed;
      const principal = await authorizeWorkspace(env, {
        identity,
        requestId,
        workspaceId,
      });
      const operation =
        request.method === "POST" ? "agent-config-set" : "agent-config-get";
      const workspace = env.WORKSPACES.get(
        env.WORKSPACES.idFromName(workspaceId),
      );
      const target = new URL(request.url);
      target.searchParams.set("agentId", agentId);
      const body = request.method === "POST" ? await request.text() : undefined;
      return workspace.fetch(
        withTrustedContext(
          new Request(target.toString(), {
            method: "POST",
            headers: {
              "content-type": request.headers.get("content-type") ?? "",
              "x-chief-internal-operation": operation,
            },
            body,
          }),
          {
            principal,
            requestId,
            workspaceId,
          },
        ),
      );
    }

    const membersMatch = workspaceMembersRoute.exec(url.pathname);
    if (membersMatch && request.method === "GET") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(membersMatch[1] ?? ""),
      );
      const { identity, request: authed } = await authenticate(request, env);
      request = authed;
      const principal = await authorizeWorkspace(env, {
        identity,
        requestId,
        workspaceId,
      });
      const workspace = env.WORKSPACES.get(
        env.WORKSPACES.idFromName(workspaceId),
      );
      return workspace.fetch(
        withTrustedContext(
          new Request("https://workspace.internal/members", {
            method: "POST",
            headers: { "x-chief-internal-operation": "members-list" },
          }),
          {
            principal,
            requestId,
            workspaceId,
          },
        ),
      );
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
      const { identity, request: authed } = await authenticate(request, env);
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

    const agentSocketTicket = agentSocketTicketRoute.exec(url.pathname);
    if (agentSocketTicket && request.method === "POST") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(agentSocketTicket[1] ?? ""),
      );
      const agentId = agentIdSchema.parse(
        decodeURIComponent(agentSocketTicket[2] ?? ""),
      );
      const { identity } = await authenticate(request, env);
      const principal = await authorizeWorkspace(env, {
        identity,
        requestId,
        workspaceId,
      });
      return await routeAgentMailboxTicket(env, {
        principal,
        requestId,
        workspaceId,
        agentId,
      });
    }

    const directStart = directStartRoute.exec(url.pathname);
    if (directStart && request.method === "POST") {
      return await routeChannel(env, request, {
        requestId,
        workspaceId: decodeURIComponent(directStart[1] ?? ""),
        operation: "directs-start",
      });
    }

    const channelList = channelListRoute.exec(url.pathname);
    if (channelList) {
      const workspaceId = decodeURIComponent(channelList[1] ?? "");
      if (request.method === "GET") {
        return await routeChannel(env, request, {
          requestId,
          workspaceId,
          operation: "channels-list",
        });
      }
      if (request.method === "POST") {
        return await routeChannel(env, request, {
          requestId,
          workspaceId,
          operation: "channels-create",
        });
      }
      return relayError(
        405,
        "method_not_allowed",
        "Method not allowed.",
        requestId,
      );
    }
    const channelAction = channelActionRoute.exec(url.pathname);
    if (channelAction && request.method === "POST") {
      return await routeChannel(env, request, {
        requestId,
        workspaceId: decodeURIComponent(channelAction[1] ?? ""),
        operation: `channels-${channelAction[3]}`,
      });
    }
    const channelMemberships = channelMembershipsRoute.exec(url.pathname);
    if (channelMemberships && request.method === "GET") {
      return await routeChannel(env, request, {
        requestId,
        workspaceId: decodeURIComponent(channelMemberships[1] ?? ""),
        operation: "channels-memberships-list",
      });
    }

    const channelItem = channelItemRoute.exec(url.pathname);
    if (channelItem && request.method === "GET") {
      return await routeChannel(env, request, {
        requestId,
        workspaceId: decodeURIComponent(channelItem[1] ?? ""),
        operation: "channels-get",
        conversationId: decodeURIComponent(channelItem[2] ?? ""),
      });
    }
    const channelMembers = channelMembersRoute.exec(url.pathname);
    if (channelMembers && request.method === "GET") {
      return await routeChannel(env, request, {
        requestId,
        workspaceId: decodeURIComponent(channelMembers[1] ?? ""),
        operation: "channels-members-list",
        conversationId: decodeURIComponent(channelMembers[2] ?? ""),
      });
    }
    const channelMemberAction = channelMemberActionRoute.exec(url.pathname);
    if (channelMemberAction && request.method === "POST") {
      const action = channelMemberAction[3] === "add" ? "add" : "remove";
      return await routeChannel(env, request, {
        requestId,
        workspaceId: decodeURIComponent(channelMemberAction[1] ?? ""),
        operation: `channels-members-${action}`,
      });
    }

    const attachmentUpload = attachmentsUploadRoute.exec(url.pathname);
    if (attachmentUpload && request.method === "POST") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(attachmentUpload[1] ?? ""),
      );
      const conversationId = conversationIdSchema.parse(
        decodeURIComponent(attachmentUpload[2] ?? ""),
      );
      const { identity, request: authed } = await authenticate(request, env);
      request = authed;
      const principal = await authorizeWorkspace(env, {
        identity,
        requestId,
        workspaceId,
      });
      await authorizeConversation(env, {
        principal,
        requestId,
        workspaceId,
        conversationId,
      });
      return await uploadAttachment(
        env,
        request,
        publicOrigin(url, env),
        workspaceId,
        conversationId,
      );
    }
    const attachmentRead = attachmentReadRoute.exec(url.pathname);
    if (attachmentRead && request.method === "GET") {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(attachmentRead[1] ?? ""),
      );
      const conversationId = conversationIdSchema.parse(
        decodeURIComponent(attachmentRead[2] ?? ""),
      );
      const objectName = decodeURIComponent(attachmentRead[3] ?? "");
      if (!/^[0-9a-f-]{36}\.(?:png|jpg|webp|gif)$/u.test(objectName)) {
        return relayError(
          404,
          "attachment_not_found",
          "The attachment was not found.",
          requestId,
        );
      }
      const { identity } = await authenticate(request, env);
      const principal = await authorizeWorkspace(env, {
        identity,
        requestId,
        workspaceId,
      });
      await authorizeConversation(env, {
        principal,
        requestId,
        workspaceId,
        conversationId,
      });
      return await getAttachment(
        env,
        `${workspaceId}/${conversationId}/${objectName}`,
      );
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
        return await stub.fetch(
          withTrustedAgentSocketTicket(request, {
            ticket,
            requestId,
            workspaceId,
            agentId,
          }),
        );
      }
      const conversationId = conversationIdSchema.parse(
        requestedConversationId,
      );
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
    const conversationId = conversationIdSchema.parse(
      decodeURIComponent(match?.[2] ?? ""),
    );
    const { identity, request: authed } = await authenticate(request, env);
    request = authed;
    const principal = await authorizeWorkspace(env, {
      identity,
      requestId,
      workspaceId,
    });
    await authorizeConversation(env, {
      principal,
      requestId,
      workspaceId,
      conversationId,
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

/** Authenticates, authorizes, and forwards a channels RPC with the resolved
 * principal context (so registered agents can operate as themselves). */
async function routeChannel(
  env: Env,
  request: Request,
  input: {
    requestId: string;
    workspaceId: string;
    operation: string;
    conversationId?: string;
  },
) {
  const workspaceId = workspaceIdSchema.parse(input.workspaceId);
  const { identity, request: authed } = await authenticate(request, env);
  const principal = await authorizeWorkspace(env, {
    identity,
    requestId: input.requestId,
    workspaceId,
  });
  let forwarded = authed;
  if (input.conversationId) {
    const url = new URL(authed.url);
    url.searchParams.set("conversationId", input.conversationId);
    forwarded = new Request(url.toString(), authed);
  }
  return routeChannelOperation(env, forwarded, {
    principal,
    requestId: input.requestId,
    workspaceId,
    operation: input.operation,
  });
}

async function routeWorkspaceDataRequest(
  env: Env,
  request: Request,
  requestId: string,
  rawWorkspaceId: string,
  operation: string,
) {
  const workspaceId = workspaceIdSchema.parse(rawWorkspaceId);
  const { identity, request: authed } = await authenticate(request, env);
  const principal = await authorizeWorkspace(env, {
    identity,
    requestId,
    workspaceId,
  });
  const body = request.method === "GET" ? undefined : await authed.text();
  const workspace = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId));
  return await workspace.fetch(
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

function requireAccountBinding(env: Env, bound: boolean) {
  if (env.ACCOUNT_IDENTITY_MODE === "chief-account" && !bound) {
    throw new AuthenticationError(
      "Bind this device key to the signed-in Chief account first.",
    );
  }
}

function publicOrigin(url: URL, env: Env) {
  return (env.RELAY_PUBLIC_URL ?? url.origin).replace(/\/$/u, "");
}
