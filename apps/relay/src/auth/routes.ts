import { trustedOrigins } from "@chief/auth/origins";

import { relayAuthOptions } from "./config";

const authPathPrefixes = [
  "/api/auth",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
];

export function isRelayAuthRequest(url: URL) {
  return authPathPrefixes.some(
    (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
  );
}

export async function routeRelayAuth(
  request: Request,
  env: Env,
  context?: Pick<ExecutionContext, "waitUntil">,
) {
  const origin = request.headers.get("origin");
  const allowedOrigin =
    origin && trustedOrigins(relayAuthOptions(env)).includes(origin)
      ? origin
      : null;

  if (request.method === "OPTIONS") {
    if (!allowedOrigin) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: corsHeaders(allowedOrigin),
    });
  }

  const { createRelayAuth } = await import("./server");
  const auth = await createRelayAuth(env, context);
  const response = await auth.handler(request);
  if (!allowedOrigin) return response;
  const headers = new Headers(response.headers);
  corsHeaders(allowedOrigin).forEach((value, name) => headers.set(name, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsHeaders(origin: string) {
  return new Headers({
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, HEAD, PATCH, POST, OPTIONS",
    "access-control-allow-origin": origin,
    "access-control-max-age": "86400",
    vary: "Origin",
  });
}
