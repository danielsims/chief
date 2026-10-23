import {
  agentIdSchema,
  guestIdSchema,
  userIdSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";
import { createRelayOpenApiDocument } from "@chief/relay-contracts/openapi";

import { getPublicImageAsset } from "./attachments";
import { genericGuestBrief, guestManifest } from "./channel-guest-manual";
import { relayDocsHtml } from "./docs";
import { json, relayError } from "./http";
import {
  machineInstallPowerShell,
  machineInstallScript,
} from "./machine-install";
import { publicOrigin, relayDiscovery } from "./relay-discovery";

const publicProfileImageRoute = /^\/v1\/assets\/profiles\/([^/]+)$/u;
const publicWorkspaceImageRoute = /^\/v1\/assets\/workspaces\/([^/]+)$/u;
const publicGuestImageRoute = /^\/v1\/assets\/guests\/([^/]+)$/u;
const publicAgentImageRoute = /^\/v1\/assets\/agents\/([^/]+)\/([^/]+)$/u;

export function routePublicRequest(request: Request, url: URL, env: Env) {
  if (request.method !== "GET") return undefined;
  const profileImage = publicProfileImageRoute.exec(url.pathname);
  if (profileImage) {
    const userId = userIdSchema.parse(
      decodeURIComponent(profileImage[1] ?? ""),
    );
    return getPublicImageAsset(env, `profiles/${userId}`);
  }
  const workspaceImage = publicWorkspaceImageRoute.exec(url.pathname);
  if (workspaceImage) {
    const workspaceId = workspaceIdSchema.parse(
      decodeURIComponent(workspaceImage[1] ?? ""),
    );
    return getPublicImageAsset(env, `workspaces/${workspaceId}`);
  }
  const guestImage = publicGuestImageRoute.exec(url.pathname);
  if (guestImage) {
    const guestId = guestIdSchema.parse(
      decodeURIComponent(guestImage[1] ?? ""),
    );
    return getPublicImageAsset(env, `guests/${guestId}`);
  }
  const agentImage = publicAgentImageRoute.exec(url.pathname);
  if (agentImage) {
    const workspaceId = workspaceIdSchema.parse(
      decodeURIComponent(agentImage[1] ?? ""),
    );
    const agentId = agentIdSchema.parse(
      decodeURIComponent(agentImage[2] ?? ""),
    );
    return getPublicImageAsset(env, `agents/${workspaceId}/${agentId}`);
  }
  if (url.pathname === "/install/machine")
    return new Response(machineInstallScript, {
      headers: { "content-type": "text/x-shellscript; charset=utf-8" },
    });
  if (url.pathname === "/install/machine.ps1")
    return new Response(machineInstallPowerShell, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  if (url.pathname === "/health") {
    return json({ ok: true, protocolVersion: 1 });
  }
  if (url.pathname === "/.well-known/chief-agent.json") {
    return json(guestManifest(publicOrigin(request, url, env)));
  }
  if (url.pathname === "/llms.txt") {
    return new Response(genericGuestBrief(publicOrigin(request, url, env)), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }
  if (url.pathname === "/.well-known/relay") {
    return json(relayDiscovery(request, url, env));
  }
  if (url.pathname === "/v1/openapi.json") {
    return json(createRelayOpenApiDocument(publicOrigin(request, url, env)));
  }
  if (url.pathname === "/docs") {
    return new Response(
      relayDocsHtml(`${publicOrigin(request, url, env)}/v1/openapi.json`),
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  const invite = /^\/invite\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
  if (!invite) return undefined;
  const workspaceId = workspaceIdSchema.parse(
    decodeURIComponent(invite[1] ?? ""),
  );
  const secret = decodeURIComponent(invite[2] ?? "");
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(secret)) {
    return relayError(
      404,
      "workspace_invite_not_found",
      "This invite is not valid.",
    );
  }
  // The relay is the auth server; the web app presents the invitation, signs
  // the visitor in, and accepts it against this relay.
  return Response.redirect(
    new URL(
      `/join/${encodeURIComponent(workspaceId)}/${encodeURIComponent(secret)}`,
      env.AUTH_UI_ORIGIN,
    ).toString(),
    302,
  );
}
