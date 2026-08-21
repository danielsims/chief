import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import type { StoredSession } from "./session";
import { dispatchChiefNavigation, parseChiefDeepLink } from "../app-navigation";
import { AUTH_BASE_URL } from "../config";
import { clearPkceVerifier, getPkceVerifier } from "./pkce";

export const DEEP_LINK_SCHEME = "chief-desktop";
const CLIENT_ID = "chief-desktop";
const REDIRECT_URI = "chief-desktop:///auth";
const EXPECTED_ISSUER = `${AUTH_BASE_URL}/api/auth`;

let isTauriEnv: boolean | null = null;

async function checkIsTauri() {
  if (isTauriEnv !== null) return isTauriEnv;
  try {
    isTauriEnv = isTauri();
  } catch {
    isTauriEnv = false;
  }
  return isTauriEnv;
}

async function nativeFetch() {
  return (await checkIsTauri()) ? tauriFetch : fetch;
}

async function activateAppWindow() {
  if (!(await checkIsTauri())) return;
  await invoke("activate_app_window").catch((error) => {
    console.warn("[Auth] Failed to activate app window:", error);
  });
}

interface SetupOptions {
  onSession: (session: StoredSession) => void;
  onError?: (error: unknown) => void;
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

  const handleUrls = (urls: string[]) => {
    const url = urls[0];
    if (url) void handleDeepLink(url, options);
  };
  const unlisten = await onOpenUrl(handleUrls);
  const currentUrls = await getCurrent().catch((error) => {
    console.warn("[Auth] Failed to read current deep link:", error);
    return null;
  });
  if (currentUrls?.length) {
    handleUrls(currentUrls.map((url) => url.toString()));
  }
  return unlisten;
}

async function handleDeepLink(url: string, options: SetupOptions) {
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
    if (issuer && issuer !== EXPECTED_ISSUER) {
      throw new Error("The authorization response came from another issuer.");
    }

    const session = await exchangeAuthorizationCode(code, state);
    clearPkceVerifier(state);
    void activateAppWindow();
    options.onSession(session);
  } catch (error) {
    options.onError?.(error);
  }
}

async function exchangeAuthorizationCode(code: string, state: string) {
  const verifier = getPkceVerifier(state);
  if (!verifier) {
    throw new Error(
      "This sign-in attempt expired or was opened by another app instance. Try again.",
    );
  }
  const fetcher = await nativeFetch();
  const response = await fetcher(`${AUTH_BASE_URL}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `The relay rejected the authorization code (${response.status}).`,
    );
  }
  const token = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    token_type?: string;
  };
  if (!token.access_token || token.token_type?.toLowerCase() !== "bearer") {
    throw new Error("The relay returned an invalid access token response.");
  }
  const user = await fetchUserInfo(fetcher, token.access_token);
  return {
    token: token.access_token,
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(typeof token.expires_in === "number"
      ? { expiresAt: Date.now() + token.expires_in * 1_000 }
      : {}),
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
  const fetcher = await nativeFetch();
  const response = await fetcher(`${AUTH_BASE_URL}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: session.refreshToken,
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `The relay rejected the refresh token (${response.status}).`,
    );
  }
  const token = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    token_type?: string;
  };
  if (!token.access_token || token.token_type?.toLowerCase() !== "bearer") {
    throw new Error("The relay returned an invalid refresh response.");
  }
  const user = await fetchUserInfo(fetcher, token.access_token);
  return {
    ...session,
    token: token.access_token,
    refreshToken: token.refresh_token ?? session.refreshToken,
    ...(typeof token.expires_in === "number"
      ? { expiresAt: Date.now() + token.expires_in * 1_000 }
      : {}),
    user,
    lastValidated: Date.now(),
  };
}

async function fetchUserInfo(fetcher: typeof fetch, accessToken: string) {
  const response = await fetcher(`${AUTH_BASE_URL}/api/auth/oauth2/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(
      `The relay could not resolve the signed-in user (${response.status}).`,
    );
  }
  const data = (await response.json()) as {
    sub?: string;
    name?: string;
    email?: string;
    email_verified?: boolean;
    picture?: string | null;
  };
  if (!data.sub || !data.email) {
    throw new Error("The relay returned incomplete user information.");
  }
  return {
    id: data.sub,
    name: data.name?.trim() || data.email,
    email: data.email,
    emailVerified: data.email_verified ?? false,
    ...(data.picture ? { image: data.picture } : {}),
  };
}
