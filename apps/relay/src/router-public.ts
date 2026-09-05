import { userIdSchema, workspaceIdSchema } from "@chief/relay-contracts";
import { createRelayOpenApiDocument } from "@chief/relay-contracts/openapi";

import { getPublicImageAsset } from "./attachments";
import { relayDocsHtml } from "./docs";
import { json, relayError } from "./http";
import { publicOrigin, relayDiscovery } from "./relay-discovery";

const publicProfileImageRoute = /^\/v1\/assets\/profiles\/([^/]+)$/u;
const publicWorkspaceImageRoute = /^\/v1\/assets\/workspaces\/([^/]+)$/u;

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
  if (url.pathname === "/health") {
    return json({ ok: true, protocolVersion: 1 });
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
