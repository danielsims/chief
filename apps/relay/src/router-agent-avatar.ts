import type { AgentAvatar, Principal } from "@chief/relay-contracts";
import { agentAvatarSetSchema } from "@chief/relay-contracts";

import { deleteImageAsset, uploadImageAsset } from "./attachments";
import { relayError } from "./http";
import { withTrustedContext } from "./internal-context";
import { publicOrigin } from "./relay-discovery";
import { parseAgentId, parseWorkspaceId } from "./router-agent-route-support";
import { authenticateRelayRequest } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";

const avatarRoute = /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/avatar$/u;
const avatarImageRoute =
  /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/avatar\/image$/u;

/** Where an agent's uploaded avatar is served. */
export function agentAvatarAssetPath(workspaceId: string, agentId: string) {
  return `/v1/assets/agents/${encodeURIComponent(workspaceId)}/${encodeURIComponent(agentId)}`;
}

/**
 * Sets an agent's avatar, and stores the image or sprite sheet it points at.
 * Only workspace owners and admins may change how an agent appears.
 */
export async function routeAgentAvatar(
  env: Env,
  request: Request,
  requestId: string,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const image = avatarImageRoute.exec(url.pathname);
  const avatar = image ? null : avatarRoute.exec(url.pathname);
  const route = image ?? avatar;
  if (!route) return undefined;
  if (request.method !== "POST" && !(image && request.method === "DELETE")) {
    return relayError(
      405,
      "method_not_allowed",
      "Method not allowed.",
      requestId,
    );
  }
  const workspaceId = parseWorkspaceId(route[1]);
  const agentId = parseAgentId(route[2]);
  const authenticated = await authenticateRelayRequest(request, env);
  const principal = await authorizeWorkspace(env, {
    identity: authenticated.identity,
    requestId,
    workspaceId,
  });
  if (!canManageAgents(principal)) {
    return relayError(
      403,
      "agent_avatar_denied",
      "Only a workspace owner or admin can change an agent's avatar.",
      requestId,
    );
  }
  const assetPath = agentAvatarAssetPath(workspaceId, agentId);
  const key = `agents/${workspaceId}/${agentId}`;
  if (image) {
    return request.method === "DELETE"
      ? deleteImageAsset(env, key)
      : uploadImageAsset(
          env,
          authenticated.request,
          publicOrigin(request, url, env),
          key,
          assetPath,
        );
  }
  const command = agentAvatarSetSchema.parse(
    await authenticated.request.json(),
  );
  if (
    command.avatar &&
    !isOwnAsset(
      command.avatar,
      `${publicOrigin(request, url, env)}${assetPath}`,
    )
  ) {
    return relayError(
      400,
      "agent_avatar_asset_invalid",
      "Upload the avatar image to this agent before using it.",
      requestId,
    );
  }
  const workspace = env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId));
  const target = new URL("https://workspace.internal/agent");
  target.searchParams.set("agentId", agentId);
  return workspace.fetch(
    withTrustedContext(
      new Request(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "agent-avatar-set",
        },
        body: JSON.stringify(command),
      }),
      { principal, requestId, workspaceId },
    ),
  );
}

function canManageAgents(principal: Principal) {
  return (
    principal.kind === "user" &&
    (principal.role === "owner" || principal.role === "admin")
  );
}

/** An image or sprite must be this agent's own upload on this relay. */
function isOwnAsset(avatar: AgentAvatar, assetUrl: string) {
  if (avatar.kind === "style") return true;
  try {
    const actual = new URL(avatar.url);
    const expected = new URL(assetUrl);
    return (
      actual.origin === expected.origin && actual.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}
