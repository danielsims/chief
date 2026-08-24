import {
  conversationIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { getAttachment, uploadAttachment } from "./attachments";
import { relayError } from "./http";
import { authenticateRelayRequest } from "./router-auth";
import {
  authorizeConversation,
  authorizeWorkspace,
  routeChannelOperation,
} from "./workspace-authority";

const directStartRoute = /^\/v1\/workspaces\/([^/]+)\/directs$/u;
const channelListRoute = /^\/v1\/workspaces\/([^/]+)\/channels$/u;
const channelItemRoute = /^\/v1\/workspaces\/([^/]+)\/channels\/([^/]+)$/u;
const channelActionRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/([^/]+)\/(update|archive|unarchive|join|leave)$/u;
const channelMembersRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/([^/]+)\/members$/u;
const channelMembershipsRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/memberships$/u;
const currentChannelMembershipsRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/memberships\/self$/u;
const channelMemberActionRoute =
  /^\/v1\/workspaces\/([^/]+)\/channels\/([^/]+)\/members\/(add|remove)$/u;
const attachmentsUploadRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/attachments$/u;
const attachmentReadRoute =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/attachments\/([^/]+)$/u;

export async function routeChannelRequest(
  env: Env,
  request: Request,
  requestId: string,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const direct = directStartRoute.exec(url.pathname);
  if (direct && request.method === "POST") {
    return routeChannel(env, request, requestId, direct[1], "directs-start");
  }
  const list = channelListRoute.exec(url.pathname);
  if (list) {
    const operation =
      request.method === "GET"
        ? "channels-list"
        : request.method === "POST"
          ? "channels-create"
          : undefined;
    if (!operation) {
      return relayError(
        405,
        "method_not_allowed",
        "Method not allowed.",
        requestId,
      );
    }
    return routeChannel(env, request, requestId, list[1], operation);
  }
  const action = channelActionRoute.exec(url.pathname);
  if (action && request.method === "POST") {
    return routeChannel(
      env,
      request,
      requestId,
      action[1],
      `channels-${action[3]}`,
    );
  }
  const currentMemberships = currentChannelMembershipsRoute.exec(url.pathname);
  if (currentMemberships && request.method === "GET") {
    return routeChannel(
      env,
      request,
      requestId,
      currentMemberships[1],
      "channels-memberships-self",
    );
  }
  const memberships = channelMembershipsRoute.exec(url.pathname);
  if (memberships && request.method === "GET") {
    return routeChannel(
      env,
      request,
      requestId,
      memberships[1],
      "channels-memberships-list",
    );
  }
  const item = channelItemRoute.exec(url.pathname);
  if (item && request.method === "GET") {
    return routeChannel(
      env,
      request,
      requestId,
      item[1],
      "channels-get",
      item[2],
    );
  }
  const members = channelMembersRoute.exec(url.pathname);
  if (members && request.method === "GET") {
    return routeChannel(
      env,
      request,
      requestId,
      members[1],
      "channels-members-list",
      members[2],
    );
  }
  const memberAction = channelMemberActionRoute.exec(url.pathname);
  if (memberAction && request.method === "POST") {
    const operation =
      memberAction[3] === "add"
        ? "channels-members-add"
        : "channels-members-remove";
    return routeChannel(env, request, requestId, memberAction[1], operation);
  }

  const upload = attachmentsUploadRoute.exec(url.pathname);
  if (upload && request.method === "POST") {
    const scope = await authorizeAttachment(
      env,
      request,
      requestId,
      upload[1],
      upload[2],
      "messages.send",
    );
    return uploadAttachment(
      env,
      scope.request,
      publicOrigin(url, env),
      scope.workspaceId,
      scope.conversationId,
    );
  }
  const read = attachmentReadRoute.exec(url.pathname);
  if (read && request.method === "GET") {
    const objectName = decodeURIComponent(read[3] ?? "");
    if (!/^[0-9a-f-]{36}\.(?:png|jpg|webp|gif)$/u.test(objectName)) {
      return relayError(
        404,
        "attachment_not_found",
        "The attachment was not found.",
        requestId,
      );
    }
    const scope = await authorizeAttachment(
      env,
      request,
      requestId,
      read[1],
      read[2],
      "messages.read",
    );
    return getAttachment(
      env,
      `${scope.workspaceId}/${scope.conversationId}/${objectName}`,
    );
  }
  return undefined;
}

async function routeChannel(
  env: Env,
  request: Request,
  requestId: string,
  rawWorkspaceId: string | undefined,
  operation: string,
  rawConversationId?: string,
) {
  const workspaceId = parseWorkspaceId(rawWorkspaceId);
  const authenticated = await authenticateRelayRequest(request, env);
  const principal = await authorizeWorkspace(env, {
    identity: authenticated.identity,
    requestId,
    workspaceId,
  });
  let forwarded = authenticated.request;
  if (rawConversationId) {
    const url = new URL(forwarded.url);
    url.searchParams.set(
      "conversationId",
      decodeURIComponent(rawConversationId),
    );
    forwarded = new Request(url.toString(), forwarded);
  }
  return routeChannelOperation(env, forwarded, {
    principal,
    requestId,
    workspaceId,
    operation,
  });
}

async function authorizeAttachment(
  env: Env,
  request: Request,
  requestId: string,
  rawWorkspaceId: string | undefined,
  rawConversationId: string | undefined,
  permission: "messages.read" | "messages.send",
) {
  const workspaceId = parseWorkspaceId(rawWorkspaceId);
  const conversationId = conversationIdSchema.parse(
    decodeURIComponent(rawConversationId ?? ""),
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
    permission,
  });
  return {
    request: authenticated.request,
    workspaceId,
    conversationId,
  };
}

function parseWorkspaceId(value: string | undefined) {
  return workspaceIdSchema.parse(decodeURIComponent(value ?? ""));
}

function publicOrigin(url: URL, env: Env) {
  return (env.RELAY_PUBLIC_URL ?? url.origin).replace(/\/$/u, "");
}
