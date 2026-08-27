import { Effect } from "effect";

import {
  appendMessageCommandSchema,
  conversationIdSchema,
  createWorkspaceCommandSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { deleteImageAsset, uploadImageAsset } from "./attachments";
import { AuthorizationError } from "./auth";
import { isRelayAuthRequest, routeRelayAuth } from "./auth/routes";
import { dispatchAppendedMessage } from "./conversation-agent-dispatch";
import { bindDeviceIdentity } from "./device-identities";
import {
  attempt,
  failureResponse,
  parseRelayFailure,
  runEffect,
  sync,
} from "./effect";
import { relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { connectLiveSocket } from "./live-socket-router";
import { publicOrigin } from "./relay-discovery";
import {
  enforceEdgeRequestLimit,
  enforcePublicIdentityRequestLimit,
} from "./request-rate-limits";
import { routeAgentRequest } from "./router-agent-routes";
import { authenticateRelayRequest, requireAccountBinding } from "./router-auth";
import { routeChannelRequest } from "./router-channel-routes";
import { routeOnboardingTelemetry } from "./router-onboarding";
import { routeProfileImage } from "./router-profile-image";
import { routePublicRequest } from "./router-public";
import { routeWorkspaceDataRequest } from "./router-workspace-data";
import { routeWorkspaceSecrets } from "./router-workspace-secrets";
import {
  activeManagedWorkspace,
  authorizeConversation,
  authorizeWorkspace,
  claimWorkspace,
  claimWorkspaceInvite,
  createManagedWorkspace,
  createWorkspaceInvite,
  deleteManagedWorkspace,
  joinOrganizationWorkspace,
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
const switchWorkspaceRoute = /^\/v1\/workspaces\/([^/]+)\/switch$/u;
const workspaceSocketTicketRoute =
  /^\/v1\/workspaces\/([^/]+)\/socket-tickets$/u;
const deleteWorkspaceRoute = /^\/v1\/workspaces\/([^/]+)$/u;
const workspaceInviteRoute = /^\/v1\/workspaces\/([^/]+)\/invites$/u;
const workspaceInvitePreviewRoute =
  /^\/v1\/workspaces\/([^/]+)\/invites\/preview$/u;
const workspaceInviteClaimRoute =
  /^\/v1\/workspaces\/([^/]+)\/invites\/claim$/u;
const orgJoinRoute = /^\/v1\/workspaces\/([^/]+)\/organization-membership$/u;
const workspaceLogoRoute = /^\/v1\/workspaces\/([^/]+)\/logo$/u;
const workspaceSecretsRoute = /^\/v1\/workspaces\/([^/]+)\/secrets$/u;

export async function routeRelayRequest(
  request: Request,
  env: Env,
  context: ExecutionContext,
) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const trace = await relayTraceContext(request);
  const program = Effect.gen(function* () {
    yield* attempt("relay.rate_limit.edge", () =>
      enforceEdgeRequestLimit(env, request),
    );
    yield* attempt("relay.rate_limit.identity", () =>
      enforcePublicIdentityRequestLimit(env, request),
    );
    const url = new URL(request.url);
    if (isRelayAuthRequest(url))
      return yield* attempt("relay.auth", () =>
        routeRelayAuth(request, env, context),
      );
    const publicResponse = yield* attempt("relay.public", () =>
      routePublicRequest(request, url, env),
    );
    if (publicResponse) return publicResponse;
    if (url.pathname === "/v1/identity/device" && request.method === "POST") {
      return yield* attempt("relay.device.bind", () =>
        bindDeviceIdentity(env, request),
      );
    }

    const workspaceResponse = yield* routeWorkspaceRequest(
      env,
      request,
      requestId,
      context,
    );
    if (workspaceResponse) return workspaceResponse;
    const agentResponse = yield* attempt("relay.agent", () =>
      routeAgentRequest(env, request, requestId),
    );
    if (agentResponse) return agentResponse;
    const channelResponse = yield* attempt("relay.channel", () =>
      routeChannelRequest(env, request, requestId),
    );
    if (channelResponse) return channelResponse;

    const response = yield* attempt("relay.conversation", () =>
      routeConversationRequest(env, request, requestId),
    );
    void context;
    return response;
  }).pipe(
    Effect.withSpan("relay.request", {
      attributes: {
        "http.request.method": request.method,
        "url.path": new URL(request.url).pathname,
        "chief.request.id": requestId,
        "chief.workspace.id": trace.workspaceId,
        "chief.workflow.id": trace.workflowId,
        "gen_ai.conversation.id": trace.conversationId,
        "messaging.message.id": trace.messageId,
      },
    }),
    Effect.mapError((failure) => parseRelayFailure(failure, requestId)),
    Effect.tapError((failure) =>
      Effect.logError("relay.request.failed", {
        requestId,
        method: request.method,
        pathname: new URL(request.url).pathname,
        code: failure.code,
        error:
          failure.cause instanceof Error
            ? {
                name: failure.cause.name,
                message: failure.cause.message,
                stack: failure.cause.stack,
              }
            : failure.message,
      }),
    ),
    Effect.matchEffect({
      onFailure: (failure) => Effect.succeed(failureResponse(failure)),
      onSuccess: Effect.succeed,
    }),
  );
  return runEffect(program, env, trace.workflowId);
}

async function relayTraceContext(request: Request) {
  const url = new URL(request.url);
  const match = messageRoute.exec(url.pathname);
  if (
    request.method !== "POST" ||
    !match ||
    url.pathname !==
      `/v1/workspaces/${match[1]}/conversations/${match[2]}/messages`
  ) {
    return {};
  }
  const workspace = workspaceIdSchema.safeParse(match[1]);
  const conversation = conversationIdSchema.safeParse(match[2]);
  const document = await request
    .clone()
    .json()
    .catch(() => undefined);
  const command = appendMessageCommandSchema.safeParse(document);
  const messageId = command.success
    ? command.data.payload.messageId
    : undefined;
  return {
    workspaceId: workspace.success ? workspace.data : undefined,
    conversationId: conversation.success ? conversation.data : undefined,
    workflowId: messageId,
    messageId,
  };
}

function routeWorkspaceRequest(
  env: Env,
  request: Request,
  requestId: string,
  context: ExecutionContext,
) {
  return Effect.gen(function* () {
    const authenticate = (candidate: Request) =>
      attempt("relay.authenticate", () =>
        authenticateRelayRequest(candidate, env),
      );
    const parseId = (raw: string | undefined) =>
      sync("relay.workspace.scope", () => parseWorkspaceId(raw));
    const requireBinding = (
      bound: Parameters<typeof requireAccountBinding>[1],
    ) =>
      sync("relay.account_binding.require", () =>
        requireAccountBinding(env, bound),
      );
    const url = new URL(request.url);
    const onboarding = yield* routeOnboardingTelemetry(env, request, requestId);
    if (onboarding) return onboarding;
    if (
      url.pathname === "/v1/me/avatar" &&
      (request.method === "POST" || request.method === "DELETE")
    ) {
      const authenticated = yield* authenticate(request);
      yield* requireBinding(authenticated.bound);
      const user = yield* sync("relay.user.require", () => {
        if (authenticated.identity.kind !== "user") {
          throw new AuthorizationError("A user identity is required.");
        }
        return authenticated.identity;
      });
      return yield* routeProfileImage(
        env,
        request,
        authenticated.request,
        user.userId,
      );
    }
    const invitePreview = workspaceInvitePreviewRoute.exec(url.pathname);
    if (invitePreview && request.method === "POST") {
      const workspaceId = yield* parseId(invitePreview[1]);
      return yield* attempt("relay.workspace_invite.preview", () =>
        previewWorkspaceInvite(env, request, workspaceId),
      );
    }
    if (url.pathname === "/v1/workspaces") {
      if (request.method !== "GET" && request.method !== "POST")
        return undefined;
      const authenticated = yield* authenticate(request);
      yield* requireBinding(authenticated.bound);
      if (request.method === "GET") {
        return yield* attempt("relay.workspace.list", () =>
          listManagedWorkspaces(env, authenticated.identity),
        );
      }
      const body = yield* attempt("relay.request.json", () =>
        authenticated.request.json(),
      );
      const command = yield* sync("relay.workspace_create.parse", () =>
        createWorkspaceCommandSchema.parse(body),
      );
      return yield* attempt("relay.workspace.create", () =>
        createManagedWorkspace(env, authenticated.identity, command, context),
      );
    }
    if (url.pathname === "/v1/me/workspace" && request.method === "GET") {
      const authenticated = yield* authenticate(request);
      yield* requireBinding(authenticated.bound);
      return yield* attempt("relay.workspace.active", () =>
        activeManagedWorkspace(env, authenticated.identity, context),
      );
    }
    const deletion = deleteWorkspaceRoute.exec(url.pathname);
    if (deletion && request.method === "DELETE") {
      const workspaceId = yield* parseId(deletion[1]);
      const authenticated = yield* authenticate(request);
      yield* requireBinding(authenticated.bound);
      return yield* attempt("relay.workspace.delete", () =>
        deleteManagedWorkspace(
          env,
          authenticated.identity,
          workspaceId,
          requestId,
        ),
      );
    }
    const inviteClaim = workspaceInviteClaimRoute.exec(url.pathname);
    if (inviteClaim && request.method === "POST") {
      const workspaceId = yield* parseId(inviteClaim[1]);
      const authenticated = yield* authenticate(request);
      yield* requireBinding(authenticated.bound);
      return yield* attempt("relay.workspace_invite.claim", () =>
        claimWorkspaceInvite(env, authenticated.request, {
          identity: authenticated.identity,
          requestId,
          workspaceId,
        }),
      );
    }
    const organizationJoin = orgJoinRoute.exec(url.pathname);
    if (organizationJoin && request.method === "POST") {
      const workspaceId = yield* parseId(organizationJoin[1]);
      const authenticated = yield* authenticate(request);
      yield* requireBinding(authenticated.bound);
      return yield* attempt("relay.workspace_organization.join", () =>
        joinOrganizationWorkspace(env, {
          identity: authenticated.identity,
          requestId,
          workspaceId,
        }),
      );
    }
    const workspaceLogo = workspaceLogoRoute.exec(url.pathname);
    if (
      workspaceLogo &&
      (request.method === "POST" || request.method === "DELETE")
    ) {
      const workspaceId = yield* parseId(workspaceLogo[1]);
      const authenticated = yield* authenticate(request);
      yield* requireBinding(authenticated.bound);
      const principal = yield* attempt("relay.workspace.authorize", () =>
        authorizeWorkspace(env, {
          identity: authenticated.identity,
          requestId,
          workspaceId,
        }),
      );
      if (
        principal.kind !== "user" ||
        (principal.role !== "owner" && principal.role !== "admin")
      ) {
        return yield* sync("relay.workspace_admin.require", () => {
          throw new AuthorizationError(
            "Only workspace owners and admins can change its image.",
          );
        });
      }
      const key = `workspaces/${workspaceId}`;
      return request.method === "DELETE"
        ? yield* attempt("relay.workspace_image.delete", () =>
            deleteImageAsset(env, key),
          )
        : yield* attempt("relay.workspace_image.upload", () =>
            uploadImageAsset(
              env,
              authenticated.request,
              publicOrigin(request, url, env),
              key,
              `/v1/assets/workspaces/${encodeURIComponent(workspaceId)}`,
            ),
          );
    }
    const inviteCreate = workspaceInviteRoute.exec(url.pathname);
    if (inviteCreate && request.method === "POST") {
      const workspaceId = yield* parseId(inviteCreate[1]);
      const authenticated = yield* authenticate(request);
      yield* requireBinding(authenticated.bound);
      const principal = yield* attempt("relay.workspace.authorize", () =>
        authorizeWorkspace(env, {
          identity: authenticated.identity,
          requestId,
          workspaceId,
        }),
      );
      return yield* attempt("relay.workspace_invite.create", () =>
        createWorkspaceInvite(env, authenticated.request, {
          principal,
          requestId,
          workspaceId,
        }),
      );
    }
    const switched = switchWorkspaceRoute.exec(url.pathname);
    if (switched && request.method === "POST") {
      const workspaceId = yield* parseId(switched[1]);
      const authenticated = yield* authenticate(request);
      yield* requireBinding(authenticated.bound);
      return yield* attempt("relay.workspace.switch", () =>
        switchManagedWorkspace(env, authenticated.identity, workspaceId),
      );
    }
    const claimed = claimWorkspaceRoute.exec(url.pathname);
    if (claimed && request.method === "POST") {
      const workspaceId = yield* parseId(claimed[1]);
      const authenticated = yield* authenticate(request);
      return yield* attempt("relay.workspace.claim", () =>
        claimWorkspace(env, authenticated.request, {
          identity: authenticated.identity,
          requestId,
          workspaceId,
        }),
      );
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
      const workspaceId = yield* parseId(logs[1]);
      const authenticated = yield* authenticate(request);
      yield* attempt("relay.workspace.authorize", () =>
        authorizeWorkspace(env, {
          identity: authenticated.identity,
          requestId,
          workspaceId,
        }),
      );
      return yield* attempt("relay.workspace_logs.route", () =>
        routeWorkspaceLogs(env, authenticated.request, {
          identity: authenticated.identity,
          requestId,
          workspaceId,
        }),
      );
    }
    const liveTicket = workspaceSocketTicketRoute.exec(url.pathname);
    if (liveTicket && request.method === "POST") {
      const workspaceId = yield* parseId(liveTicket[1]);
      const authenticated = yield* authenticate(request);
      const principal = yield* attempt("relay.workspace.authorize", () =>
        authorizeWorkspace(env, {
          identity: authenticated.identity,
          requestId,
          workspaceId,
        }),
      );
      return yield* attempt("relay.workspace_live.ticket", () =>
        env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
          withTrustedContext(
            new Request("https://workspace.internal/socket-tickets", {
              method: "POST",
              headers: { "x-chief-internal-operation": "live-socket-ticket" },
            }),
            { principal, requestId, workspaceId },
          ),
        ),
      );
    }
    const secrets = workspaceSecretsRoute.exec(url.pathname);
    if (secrets && url.pathname === `/v1/workspaces/${secrets[1]}/secrets`) {
      return yield* routeWorkspaceSecrets(env, request, requestId, secrets[1]);
    }
    return yield* routeWorkspaceDataRequest(env, request, requestId, url);
  }).pipe(Effect.withSpan("relay.workspace"));
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
  const response = await conversationStub(
    env,
    workspaceId,
    conversationId,
  ).fetch(
    withTrustedContext(authenticated.request, {
      principal,
      requestId,
      workspaceId,
      conversationId,
    }),
  );
  return dispatchAppendedMessage(env, {
    request: authenticated.request,
    response,
    principal,
    requestId,
    workspaceId,
    conversationId,
  });
}

function conversationPermission(
  request: Request,
): "messages.read" | "messages.send" | "messages.manage" {
  if (request.method === "GET") return "messages.read";
  const path = new URL(request.url).pathname;
  return path.endsWith("/edit") || request.method === "DELETE"
    ? "messages.manage"
    : "messages.send";
}

const conversationStub = (
  env: Env,
  workspaceId: string,
  conversationId: string,
) =>
  env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${workspaceId}:${conversationId}`),
  );
const parseWorkspaceId = (value: string | undefined) =>
  workspaceIdSchema.parse(decodeURIComponent(value ?? ""));
