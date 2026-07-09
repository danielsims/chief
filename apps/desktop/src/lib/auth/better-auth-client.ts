import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { StoredSession } from "./session";
import { getStoredSession, setStoredSession } from "./session";

export const AUTH_BASE_URL =
  (import.meta.env.VITE_AUTH_BASE_URL as string | undefined) ??
  (globalThis as unknown as { __AUTH_BASE_URL__?: string }).__AUTH_BASE_URL__ ??
  "http://localhost:3000";

// Always use Tauri's native HTTP fetch when in Tauri context.
// Tauri's native fetch bypasses CORS in both dev and production.
const fetchImpl: typeof fetch = async (input, init) => {
  const storedSession = getStoredSession();
  const headers = new Headers(init?.headers);

  if (storedSession?.token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${storedSession.token}`);
  }

  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  console.log("[Auth Fetch]", init?.method ?? "GET", url);

  const nextInit = {
    ...init,
    credentials: "include" as const,
    headers,
  };

  return isTauri() ? tauriFetch(input, nextInit) : fetch(input, nextInit);
};

export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  basePath: "/api/auth",
  plugins: [organizationClient()],
  fetchOptions: {
    customFetchImpl: fetchImpl,
  },
});

/**
 * Result of checking a cached session token against the server.
 *
 * - `valid`   — the server resolved a live session for the token.
 * - `invalid` — the server explicitly rejected the token (it's dead/expired).
 *               The caller should clear the cached session and re-authenticate.
 * - `unknown` — the check couldn't complete (offline, 5xx, etc.). The caller
 *               should keep the cached session so transient failures don't
 *               sign users out.
 */
export type SessionValidationResult =
  | { status: "valid"; user: StoredSession["user"]; organizationId?: string }
  | { status: "invalid" }
  | { status: "unknown" };

/**
 * Validate a stored session token against the auth server.
 *
 * The desktop caches the session in localStorage and otherwise trusts it
 * indefinitely. That cache can outlive the server-side session — it expires,
 * or a backend auth deploy invalidates old tokens. When that happens every
 * authenticated cloud call silently 401s while the UI still shows the user as
 * signed in. Calling this on launch lets us detect a dead token and prompt a
 * clean re-login instead.
 */
export async function validateStoredSession(
  token: string,
): Promise<SessionValidationResult> {
  try {
    const fetcher = isTauri() ? tauriFetch : fetch;
    const response = await fetcher(`${AUTH_BASE_URL}/api/auth/get-session`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // 401 means the token was rejected outright.
    if (response.status === 401) return { status: "invalid" };
    // Any other non-2xx (5xx, gateway errors) is transient — keep the session.
    if (!response.ok) return { status: "unknown" };

    // better-auth returns `null` (HTTP 200) when the session can't be
    // resolved, which is also a definitive "this token is dead".
    const data = (await response.json()) as {
      user?: StoredSession["user"];
      session?: { activeOrganizationId?: string };
    } | null;
    if (!data?.user) return { status: "invalid" };

    return {
      status: "valid",
      user: data.user,
      organizationId: data.session?.activeOrganizationId,
    };
  } catch {
    // Network/transport failure — don't sign out offline users.
    return { status: "unknown" };
  }
}

export interface AuthOrganization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
}

export async function listAuthOrganizations(): Promise<AuthOrganization[]> {
  // Use direct fetch to the BetterAuth org list endpoint
  // rather than the authClient's organization plugin, which has
  // URL resolution issues in the Tauri desktop context.
  const storedSession = getStoredSession();
  if (!storedSession?.token) return [];

  try {
    const url = `${AUTH_BASE_URL}/api/auth/organization/list`;
    const fetcher = isTauri() ? tauriFetch : fetch;
    const response = await fetcher(url, {
      headers: {
        Authorization: `Bearer ${storedSession.token}`,
      },
    });

    if (!response.ok) {
      console.error("[Auth] listOrganizations failed:", response.status);
      return [];
    }

    const data = (await response.json()) as AuthOrganization[] | null;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("[Auth] listOrganizations error:", error);
    return [];
  }
}

export async function setActiveAuthOrganization(
  organizationId: string,
): Promise<void> {
  const storedSession = getStoredSession();
  if (!storedSession?.token) throw new Error("Not authenticated");

  const url = `${AUTH_BASE_URL}/api/auth/organization/set-active`;
  const fetcher = isTauri() ? tauriFetch : fetch;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${storedSession.token}`,
    },
    body: JSON.stringify({ organizationId }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to switch organization: ${response.status} ${text}`,
    );
  }

  setStoredSession({
    ...storedSession,
    organizationId,
    lastValidated: Date.now(),
  });
}

export async function updateAuthOrganization(
  organizationId: string,
  data: { name?: string; logo?: string },
): Promise<void> {
  const storedSession = getStoredSession();
  if (!storedSession?.token) throw new Error("Not authenticated");

  const url = `${AUTH_BASE_URL}/api/auth/organization/update`;
  const fetcher = isTauri() ? tauriFetch : fetch;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${storedSession.token}`,
    },
    body: JSON.stringify({ organizationId, data }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to update organization: ${response.status} ${text}`,
    );
  }
}

export async function createAuthOrganization(input: {
  name: string;
  slug: string;
}): Promise<AuthOrganization> {
  const storedSession = getStoredSession();
  if (!storedSession?.token) throw new Error("Not authenticated");

  const url = `${AUTH_BASE_URL}/api/auth/organization/create`;
  const fetcher = isTauri() ? tauriFetch : fetch;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${storedSession.token}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to create organization: ${response.status} ${text}`,
    );
  }

  const responseData = (await response.json()) as AuthOrganization | null;
  if (!responseData) throw new Error("No organization returned");
  return responseData;
}
