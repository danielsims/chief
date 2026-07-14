/**
 * Desktop Auth Client
 *
 * Handles the desktop PKCE OAuth flow:
 *
 * 1. signIn() in auth-context generates PKCE params and opens the browser
 * 2. User signs in via Google OAuth in the browser
 * 3. Server creates a verification record with the PKCE code_challenge
 * 4. Success page reads the authorization code cookie and redirects to deep link
 * 5. Deep link handler (this file) receives chief-desktop:///auth#token=xxx
 * 6. Decodes the token to get {identifier, state}
 * 7. Retrieves the stored code_verifier using the state
 * 8. Exchanges the code for a session token via POST /desktop/token
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import type { StoredSession } from "./session";
import { AUTH_BASE_URL } from "./better-auth-client";
import { clearPkceVerifier, getPkceVerifier } from "./pkce";

export const DEEP_LINK_SCHEME = "chief-desktop";

let isTauriEnv: boolean | null = null;

async function checkIsTauri(): Promise<boolean> {
  if (isTauriEnv !== null) return isTauriEnv;
  try {
    isTauriEnv = isTauri();
  } catch {
    isTauriEnv = false;
  }
  return isTauriEnv;
}

async function activateAppWindow() {
  if (!(await checkIsTauri())) return;
  await invoke("activate_app_window").catch((error) => {
    console.warn("[Auth] Failed to activate app window:", error);
  });
}

// ─── Deep Link Listener ──────────────────────────────────────────────────

interface SetupOptions {
  onSession: (session: StoredSession) => void;
  onError?: (error: unknown) => void;
}

interface DesktopSessionResponse {
  session?: {
    token?: string;
    activeOrganizationId?: string | null;
  };
  user?: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string | null;
  };
}

/**
 * Set up deep link listener for auth callbacks.
 * Call once on app startup. Returns a cleanup function.
 */
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
    if (!urls.length) return;
    handleDeepLink(urls[0]!, options);
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
  const { onSession, onError } = options;

  try {
    console.log("[Auth] Deep link received:", url.substring(0, 80));
    void activateAppWindow();

    const parsedUrl = new URL(url);

    // Billing completion links only need to launch and focus the app. They do
    // not carry an auth token and must not enter the PKCE error path below.
    if (parsedUrl.pathname === "/billing/success") return;

    const directSessionToken = parsedUrl.searchParams.get("session_token");
    if (directSessionToken) {
      const session = await hydrateSessionFromToken(directSessionToken);
      void activateAppWindow();
      onSession(session);
      return;
    }

    // Parse either:
    // - chief-desktop:///auth?token=xxx (Windows-safe)
    // - chief-desktop:///auth#token=xxx (legacy macOS path)
    const encodedToken =
      parsedUrl.searchParams.get("token") ?? getHashParam(url, "token");

    if (!encodedToken) {
      const error =
        parsedUrl.searchParams.get("error") ?? getHashParam(url, "error");
      onError?.(new Error(error || "No token in deep link"));
      return;
    }

    console.log("[Auth] Exchanging PKCE code for session...");
    await exchangeRedirectToken(encodedToken, options);
  } catch (err) {
    onError?.(err);
  }
}

export async function pollForDesktopPkce(
  state: string,
  options: SetupOptions,
): Promise<() => void> {
  let stopped = false;
  const intervalMs = 500;
  const timeoutMs = 2 * 60 * 1000;
  const startedAt = Date.now();
  const fetcher = (await checkIsTauri()) ? tauriFetch : fetch;

  const poll = async () => {
    if (stopped) return;

    try {
      const response = await fetcher(
        `${AUTH_BASE_URL}/api/desktop-auth/pkce?state=${encodeURIComponent(state)}`,
        {
          headers: {
            Origin: "http://localhost:1420",
          },
        },
      );

      if (stopped) return;

      if (response.status === 202) {
        if (Date.now() - startedAt >= timeoutMs) {
          stopped = true;
          options.onError?.(
            new Error(
              "Desktop sign-in timed out before the session became available",
            ),
          );
          return;
        }

        window.setTimeout(() => {
          void poll();
        }, intervalMs);
        return;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        stopped = true;
        options.onError?.(
          new Error(`Desktop auth poll failed: ${response.status} ${text}`),
        );
        return;
      }

      const data = (await response.json()) as {
        status?: string;
        redirectToken?: string;
      };

      if (data.status !== "complete" || !data.redirectToken) {
        stopped = true;
        options.onError?.(
          new Error("Desktop PKCE poll returned an invalid payload"),
        );
        return;
      }

      await exchangeRedirectToken(data.redirectToken, options);
      stopped = true;
    } catch (error) {
      if (stopped) return;
      stopped = true;
      options.onError?.(error);
    }
  };

  void poll();

  return () => {
    stopped = true;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function hydrateSessionFromToken(
  sessionToken: string,
): Promise<StoredSession> {
  const fetcher = (await checkIsTauri()) ? tauriFetch : fetch;
  const response = await fetcher(`${AUTH_BASE_URL}/api/desktop-auth/session`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Origin: "http://localhost:1420",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Desktop session lookup failed: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as DesktopSessionResponse;
  if (!data.session?.token || !data.user) {
    throw new Error("Desktop session lookup returned an invalid payload");
  }

  return {
    token: data.session.token,
    user: {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      emailVerified: data.user.emailVerified,
      image: data.user.image ?? undefined,
    },
    organizationId:
      typeof data.session.activeOrganizationId === "string"
        ? data.session.activeOrganizationId
        : undefined,
    lastValidated: Date.now(),
  };
}

// States with an exchange in flight or completed. The polling path and the
// deep link can both deliver the same authorization code; the server-side
// verification record is one-time use, so only the first attempt may POST.
const handledStates = new Set<string>();

async function exchangeRedirectToken(
  encodedToken: string,
  options: SetupOptions,
) {
  const decoded = base64UrlDecode(encodedToken);
  const tokenData = JSON.parse(decoded) as {
    identifier: string;
    state: string;
  };

  if (!tokenData.identifier || !tokenData.state) {
    throw new Error("Invalid token format in desktop PKCE redirect");
  }

  if (handledStates.has(tokenData.state)) {
    console.log("[Auth] Exchange already handled for state, skipping");
    return;
  }
  handledStates.add(tokenData.state);

  const codeVerifier = getPkceVerifier(tokenData.state);
  if (!codeVerifier) {
    throw new Error(
      "No sign-in attempt found for this state. It may have expired, or the link was opened in a different app instance. Try signing in again.",
    );
  }

  try {
    const fetcher = (await checkIsTauri()) ? tauriFetch : fetch;
    const response = await fetcher(`${AUTH_BASE_URL}/api/auth/desktop/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: tokenData.identifier,
        state: tokenData.state,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Token exchange failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      token?: string;
    };

    if (!data.token) {
      throw new Error("Invalid response from token exchange");
    }

    const session = await hydrateSessionFromToken(data.token);
    void activateAppWindow();
    options.onSession(session);
    clearPkceVerifier(tokenData.state);
  } catch (error) {
    // Allow the other delivery path (poll vs deep link) to retry.
    handledStates.delete(tokenData.state);
    throw error;
  }
}

function base64UrlDecode(str: string): string {
  // Restore standard base64
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
  while (base64.length % 4) base64 += "=";
  return atob(base64);
}

function getHashParam(url: string, key: string): string | null {
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return null;
  const fragment = url.substring(hashIndex + 1);
  return new URLSearchParams(fragment).get(key);
}
