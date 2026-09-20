import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";

const bearerPrefix = "bearer ";
const oauthAccessTokenPrefix = "chief_at_";

/**
 * Native Chief clients authenticate with opaque OAuth access tokens. Better
 * Auth's bearer plugin only hydrates session cookies from session tokens, so
 * map `chief_at_*` tokens onto the session that issued them before other
 * hooks run. That lets `/delete-user` and other session routes accept the
 * same credential the iPhone already stores.
 */
export function storedOAuthAccessToken(token: string) {
  if (!token.startsWith(oauthAccessTokenPrefix)) return null;
  return token.slice(oauthAccessTokenPrefix.length);
}

export function oauthAccessTokenSession(): BetterAuthPlugin {
  return {
    id: "chief-oauth-access-token-session",
    hooks: {
      before: [
        {
          matcher(context) {
            const header = authorizationHeader(context);
            return (
              header.slice(0, bearerPrefix.length).toLowerCase() ===
                bearerPrefix &&
              storedOAuthAccessToken(
                header.slice(bearerPrefix.length).trim(),
              ) !== null
            );
          },
          handler: createAuthMiddleware(async (context) => {
            const header = authorizationHeader(context);
            const token = header.slice(bearerPrefix.length).trim();
            const stored = storedOAuthAccessToken(token);
            if (!stored) return;
            const access = await context.context.adapter.findOne<{
              sessionId: string | null;
            }>({
              model: "oauthAccessToken",
              where: [{ field: "token", value: stored }],
            });
            if (!access?.sessionId) return;
            const session = await context.context.adapter.findOne<{
              token: string;
            }>({
              model: "session",
              where: [{ field: "id", value: access.sessionId }],
            });
            if (!session?.token) return;
            const headers = new Headers(
              context.request?.headers ?? context.headers ?? undefined,
            );
            headers.set("authorization", `Bearer ${session.token}`);
            return { context: { headers } };
          }),
        },
      ],
    },
  };
}

function authorizationHeader(context: {
  headers?: Headers | null;
  request?: Request | null;
}) {
  return (
    context.request?.headers.get("authorization") ??
    context.headers?.get("authorization") ??
    ""
  );
}
