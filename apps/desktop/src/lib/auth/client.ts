import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { z } from "zod";

import { isJsonNumber } from "@chief/relay-contracts";

import type { PkceAttempt } from "./pkce";
import type { StoredSession } from "./session";
import { dispatchChiefNavigation, parseChiefDeepLink } from "../app-navigation";
import { AUTH_BASE_URL, AUTH_UI_BASE_URL, RELAY_URL } from "../config";
import { fetchWithTimeout } from "../fetch-with-timeout";
import {
  parseOrganizationInvitationUrl,
  storePendingOrganizationInvitation,
} from "../organization-invitation";
import { authUserInfoSchema } from "./better-auth-contracts";
import { desktopAuthorizationRedirectUri } from "./desktop-redirect";
import { oauthIssuerMatches } from "./oauth-issuer";
import {
  DESKTOP_OAUTH_LOOPBACK_EVENT,
  isDesktopOAuthCallback,
} from "./oauth-loopback";
import { OAuthTokenError } from "./oauth-token-error";
import { clearPkceVerifier, getPkceAttempt } from "./pkce";

export const DEEP_LINK_SCHEME = "chief-desktop";
const CLIENT_ID = "chief-desktop";
const oauthTokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  token_type: z.string(),
});

let isTauriEnv: boolean | null = null;

function checkIsTauri(): Promise<boolean> {
  if (isTauriEnv !== null) return Promise.resolve(isTauriEnv);
  try {
    isTauriEnv = isTauri();
  } catch {
    isTauriEnv = false;
  }
  return Promise.resolve(isTauriEnv);
}

async function nativeFetch() {
  return (await checkIsTauri()) ? tauriFetch : fetch;
}

async function boundedNativeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  return fetchWithTimeout(await nativeFetch(), input, init);
}

async function activateAppWindow() {
  if (!(await checkIsTauri())) return;
  await invoke("activate_app_window").catch((error) => {
    console.warn("[Auth] Failed to activate app window:", error);
  });
}

interface SetupOptions {
  onSession: (
    session: StoredSession,
    relayOrigin: string,
  ) => void | Promise<void>;
  onError?: (error: Error) => void;
}

/** Register the operating-system callback for the OAuth 2.1 authorization code flow. */
export async function setupAuthDeepLink(
  options: SetupOptions,
): Promise<(() => void) | undefined> {
  if (!(await checkIsTauri())) return;

  const { getCurrent, isRegistered, onOpenUrl, register } =
    await import("@tauri-apps/plugin-deep-link");
  const { platform } = await import("@tauri-apps/plugin-os");
  const os = platform();
  if (os === "windows" || os === "linux") {
    try {
      if (!(await isRegistered(DEEP_LINK_SCHEME))) {
        await register(DEEP_LINK_SCHEME);
      }
    } catch (error) {
      console.warn("[Auth] Deep link registration check failed:", error);
    }
  }

  const handleUrls = (urls: string[], reportMissingAttempt: boolean) => {
    const url = urls[0];
    if (url) {
      void handleDeepLink(
        url,
        options,
        reportMissingAttempt || isDesktopOAuthCallback(url),
      );
    }
  };
  const unlistenDeepLink = await onOpenUrl((urls) => handleUrls(urls, true));
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenLoopback = await listen<string>(
    DESKTOP_OAUTH_LOOPBACK_EVENT,
    (event) => handleUrls([event.payload], true),
  );
  const currentUrls = await getCurrent().catch((error) => {
    console.warn("[Auth] Failed to read current deep link:", error);
    return null;
  });
  if (currentUrls?.length) {
    handleUrls(
      currentUrls.map((url) => url.toString()),
      false,
    );
  }
  return () => {
    unlistenDeepLink();
    void unlistenLoopback();
  };
}

async function handleDeepLink(
  url: string,
  options: SetupOptions,
  reportMissingAttempt: boolean,
) {
  try {
    void activateAppWindow();
    const parsedUrl = new URL(url);

    if (
      parsedUrl.protocol === "chief-desktop:" &&
      parsedUrl.hostname === "join"
    ) {
      window.location.assign(
        `/workspaces/new?invite=${encodeURIComponent(parsedUrl.toString())}`,
      );
      return;
    }

    if (
      parsedUrl.protocol === "chief-desktop:" &&
      parsedUrl.hostname === "organization-invite"
    ) {
      const invitation = parseOrganizationInvitationUrl(parsedUrl.toString());
      if (invitation.relayUrl === new URL(RELAY_URL).origin) {
        storePendingOrganizationInvitation(invitation);
        window.location.assign("/");
      } else {
        window.location.assign(
          `/workspaces/new?organizationInvite=${encodeURIComponent(parsedUrl.toString())}`,
        );
      }
      return;
    }

    const navigationTarget = parseChiefDeepLink(url);
    if (navigationTarget) {
      dispatchChiefNavigation(navigationTarget);
      return;
    }
    if (parsedUrl.pathname === "/billing/success") {
      window.dispatchEvent(
        new CustomEvent("chief:billing-success", {
          detail: { sessionId: parsedUrl.searchParams.get("session_id") },
        }),
      );
      return;
    }

    const error = parsedUrl.searchParams.get("error");
    if (error) {
      throw new Error(parsedUrl.searchParams.get("error_description") ?? error);
    }
    const code = parsedUrl.searchParams.get("code");
    const state = parsedUrl.searchParams.get("state");
    const issuer = parsedUrl.searchParams.get("iss");
    if (!code || !state) {
      throw new Error("The authorization response is incomplete.");
    }
    const attempt = await getPkceAttempt(state);
    if (!attempt) {
      if (reportMissingAttempt) {
        throw new Error(
          "This sign-in attempt expired or was already completed. Start sign-in again.",
        );
      }
      return;
    }
    if (
      issuer &&
      !(await oauthIssuerMatches(
        issuer,
        attempt.authBaseUrl,
        boundedNativeFetch,
      ))
    ) {
      throw new Error("The authorization response came from another issuer.");
    }

    const session = await exchangeAuthorizationCode(code, attempt);
    await clearPkceVerifier(state);
    void activateAppWindow();
    await options.onSession(session, attempt.relayOrigin);
  } catch (error) {
    options.onError?.(parseAuthError(error));
  }
}

function parseAuthError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function exchangeAuthorizationCode(code: string, attempt: PkceAttempt) {
  const response = await boundedNativeFetch(
    `${attempt.authBaseUrl}/api/auth/oauth2/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        code_verifier: attempt.verifier,
        redirect_uri:
          attempt.redirectUri ??
          desktopAuthorizationRedirectUri(AUTH_UI_BASE_URL),
      }).toString(),
    },
  );
  if (!response.ok) {
    throw new OAuthTokenError(
      `The relay rejected the authorization code (${response.status}).`,
      response.status,
    );
  }
  const token = oauthTokenSchema.parse(await response.json());
  if (token.token_type.toLowerCase() !== "bearer") {
    throw new Error("The relay returned an invalid access token response.");
  }
  const user = await fetchUserInfo(token.access_token, attempt.authBaseUrl);
  return {
    token: token.access_token,
    ...(token.refresh_token
      ? { refreshToken: token.refresh_token }
      : undefined),
    ...(isJsonNumber(token.expires_in)
      ? { expiresAt: Date.now() + token.expires_in * 1_000 }
      : undefined),
    user,
    lastValidated: Date.now(),
  } satisfies StoredSession;
}

export async function refreshOAuthSession(
  session: StoredSession,
): Promise<StoredSession> {
  if (!session.refreshToken) {
    throw new Error("This session cannot be refreshed.");
  }
  const response = await boundedNativeFetch(
    `${AUTH_BASE_URL}/api/auth/oauth2/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: session.refreshToken,
      }).toString(),
    },
  );
  if (!response.ok) {
    throw new OAuthTokenError(
      `The relay rejected the refresh token (${response.status}).`,
      response.status,
    );
  }
  const token = oauthTokenSchema.parse(await response.json());
  if (token.token_type.toLowerCase() !== "bearer") {
    throw new Error("The relay returned an invalid refresh response.");
  }
  const user = await fetchUserInfo(token.access_token);
  return {
    ...session,
    token: token.access_token,
    refreshToken: token.refresh_token ?? session.refreshToken,
    ...(isJsonNumber(token.expires_in)
      ? { expiresAt: Date.now() + token.expires_in * 1_000 }
      : undefined),
    user,
    lastValidated: Date.now(),
  };
}

async function fetchUserInfo(accessToken: string, authBaseUrl = AUTH_BASE_URL) {
  const response = await boundedNativeFetch(
    `${authBaseUrl}/api/auth/oauth2/userinfo`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new OAuthTokenError(
      `The relay could not resolve the signed-in user (${response.status}).`,
      response.status,
    );
  }
  const data = authUserInfoSchema.parse(await response.json());
  return {
    id: data.sub,
    name: data.name?.trim() ?? data.email,
    email: data.email,
    emailVerified: data.email_verified ?? false,
    ...(data.picture ? { image: data.picture } : undefined),
  };
}
