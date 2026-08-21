import type { ChiefAuthOptions } from "@chief/auth";

export function relayAuthOptions(env: Env): ChiefAuthOptions {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectURI: env.AUTH_GOOGLE_REDIRECT_URI,
        }
      : undefined;

  return {
    baseURL: env.AUTH_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    uiOrigin: env.AUTH_UI_ORIGIN,
    google,
  };
}
