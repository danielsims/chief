import { openUrl } from "@tauri-apps/plugin-opener";

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
import {
  adoptRefreshedSession,
  createOAuthRefreshGate,
  resolveStoredOAuthSession,
} from "./oauth-session-refresh";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  storePkceVerifier,
} from "./pkce";
import { getStoredSession, setStoredSession } from "./session";

export {
  ACCESS_TOKEN_REFRESH_LEAD_MS,
  asError,
  nextAccessTokenRefreshDelay,
  sessionNeedsAccessTokenRefresh,
} from "./oauth-session-refresh";

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
  const redirectUri = desktopAuthorizationRedirectUri(connection.authUiUrl);
  await storePkceVerifier(state, codeVerifier, {
    relayOrigin: connection.relayUrl,
    authBaseUrl: connection.authBaseUrl,
    redirectUri,
  });

  const signInUrl = new URL("/api/auth/oauth2/authorize", connection.authUiUrl);
  signInUrl.searchParams.set("client_id", "chief-desktop");
  signInUrl.searchParams.set("redirect_uri", redirectUri);
  signInUrl.searchParams.set("response_type", "code");
  signInUrl.searchParams.set("scope", "openid profile email offline_access");
  signInUrl.searchParams.set("code_challenge", codeChallenge);
  signInUrl.searchParams.set("code_challenge_method", "S256");
  signInUrl.searchParams.set("state", state);
  signInUrl.searchParams.set("resource", connection.authBaseUrl);
  await openUrl(signInUrl.toString());
}

const refreshOAuthSessionOnce = createOAuthRefreshGate(async (session) => {
  const refreshed = await refreshOAuthSession(session);
  const adopted = adoptRefreshedSession(getStoredSession(), session, refreshed);
  if (adopted === refreshed) setStoredSession(refreshed);
  return adopted;
});

export async function validateOrRefreshSession(session: StoredSession) {
  return resolveStoredOAuthSession(session, {
    refresh: refreshOAuthSessionOnce,
    validate: validateStoredSession,
  });
}
