import { openUrl } from "@tauri-apps/plugin-opener";

import { isJsonNumber } from "@chief/relay-contracts";

import type { StoredRelayConnection } from "../relay-connection";
import type { StoredSession } from "./session";
import {
  CHIEF_CLOUD_AUTH_BASE_URL,
  CHIEF_CLOUD_AUTH_UI_URL,
  CHIEF_CLOUD_RELAY_URL,
} from "../config";
import { validateStoredSession } from "./better-auth-client";
import { refreshOAuthSession } from "./client";
import { desktopAuthorizationRedirectUri } from "./desktop-redirect";
import { shouldInvalidateOAuthSession } from "./oauth-token-error";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  storePkceVerifier,
} from "./pkce";

export const chiefAccountConnection: StoredRelayConnection = {
  version: 1,
  relayUrl: new URL(CHIEF_CLOUD_RELAY_URL).origin,
  authBaseUrl: new URL(CHIEF_CLOUD_AUTH_BASE_URL).origin,
  authUiUrl: new URL(CHIEF_CLOUD_AUTH_UI_URL).origin,
};

export async function openRelayAuthorization(
  connection: StoredRelayConnection,
): Promise<void> {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  await storePkceVerifier(state, codeVerifier, {
    relayOrigin: connection.relayUrl,
    authBaseUrl: connection.authBaseUrl,
  });

  const signInUrl = new URL("/api/auth/oauth2/authorize", connection.authUiUrl);
  signInUrl.searchParams.set("client_id", "chief-desktop");
  signInUrl.searchParams.set(
    "redirect_uri",
    desktopAuthorizationRedirectUri(connection.authUiUrl),
  );
  signInUrl.searchParams.set("response_type", "code");
  signInUrl.searchParams.set("scope", "openid profile email offline_access");
  signInUrl.searchParams.set("code_challenge", codeChallenge);
  signInUrl.searchParams.set("code_challenge_method", "S256");
  signInUrl.searchParams.set("state", state);
  signInUrl.searchParams.set("resource", connection.authBaseUrl);
  await openUrl(signInUrl.toString());
}

export async function validateOrRefreshSession(session: StoredSession) {
  const shouldRefresh =
    Boolean(session.refreshToken) &&
    isJsonNumber(session.expiresAt) &&
    session.expiresAt <= Date.now() + 60_000;
  if (shouldRefresh) {
    try {
      return await refreshOAuthSession(session);
    } catch (error) {
      return shouldInvalidateOAuthSession(
        asError(error instanceof Error ? error : String(error)),
      )
        ? null
        : session;
    }
  }
  const validation = await validateStoredSession(session.token);
  if (validation.status === "valid") {
    return {
      ...session,
      user: validation.user,
      organizationId: validation.organizationId ?? session.organizationId,
      lastValidated: Date.now(),
    };
  }
  if (validation.status === "unknown") return session;
  if (!session.refreshToken) return null;
  try {
    return await refreshOAuthSession(session);
  } catch (error) {
    return shouldInvalidateOAuthSession(
      asError(error instanceof Error ? error : String(error)),
    )
      ? null
      : session;
  }
}

export function asError(value: Error | string): Error {
  return value instanceof Error ? value : new Error(String(value));
}
