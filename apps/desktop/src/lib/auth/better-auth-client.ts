import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { JsonObject } from "@chief/relay-contracts";
import { toJsonObject } from "@chief/relay-contracts";

import type { AuthOrganization } from "./better-auth-contracts";
import type { OrganizationRole } from "./organization-role";
import type { StoredSession } from "./session";
import { AUTH_BASE_URL } from "../config";
import { fetchWithTimeout } from "../fetch-with-timeout";
import {
  authOrganizationSchema,
  authUserInfoSchema,
  normalizeOrganizations,
  organizationCacheSchema,
  organizationMemberSchema,
} from "./better-auth-contracts";
import { primaryOrganizationRole } from "./organization-role";
import { getStoredSession, setStoredSession } from "./session";

export { AUTH_BASE_URL } from "../config";
export type { AuthOrganization } from "./better-auth-contracts";
export { parseOrganizationMetadata } from "./better-auth-contracts";

const authClientBaseUrl = AUTH_BASE_URL;

// Always use Tauri's native HTTP fetch when in Tauri context.
// Tauri's native fetch bypasses CORS in both dev and production.
const fetchImpl: typeof fetch = async (input, init) => {
  const storedSession = getStoredSession();
  const headers = new Headers(init?.headers);

  if (storedSession?.token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${storedSession.token}`);
  }

  const url =
    input instanceof URL
      ? input.toString()
      : input instanceof Request
        ? input.url
        : input;
  console.log("[Auth Fetch]", init?.method ?? "GET", url);

  const nextInit = {
    ...init,
    credentials: "include" as const,
    headers,
  };

  return isTauri() ? tauriFetch(input, nextInit) : fetch(input, nextInit);
};

export const authClient = createAuthClient({
  baseURL: authClientBaseUrl,
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
 * The desktop caches the session in memory after loading it from Keychain.
 * That cache can outlive the server-side session — it expires,
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
    const response = await fetchWithTimeout(
      fetcher,
      `${AUTH_BASE_URL}/api/auth/oauth2/userinfo`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    // 401 means the token was rejected outright.
    if (response.status === 401) return { status: "invalid" };
    // Any other non-2xx (5xx, gateway errors) is transient — keep the session.
    if (!response.ok) return { status: "unknown" };

    const result = authUserInfoSchema.safeParse(await response.json());
    if (!result.success) return { status: "invalid" };
    const data = result.data;
    const user: StoredSession["user"] = {
      id: data.sub,
      name: data.name?.trim() ?? data.email,
      email: data.email,
      emailVerified: data.email_verified ?? false,
    };
    if (data.picture) user.image = data.picture;

    return {
      status: "valid",
      user,
    };
  } catch {
    // Network/transport failure — don't sign out offline users.
    return { status: "unknown" };
  }
}

export interface AuthOrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

/** Resolve the signed-in user's live role in their active Better Auth organization. */
export async function getActiveAuthOrganizationMember(
  expectedOrganizationId: string,
): Promise<AuthOrganizationMember | null> {
  const storedSession = getStoredSession();
  if (!storedSession?.token || !AUTH_BASE_URL) return null;
  const fetcher = isTauri() ? tauriFetch : fetch;
  const response = await fetchWithTimeout(
    fetcher,
    `${AUTH_BASE_URL}/api/auth/organization/get-active-member`,
    { headers: { Authorization: `Bearer ${storedSession.token}` } },
  );
  if (!response.ok) return null;
  const result = organizationMemberSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!result.success) return null;
  const member = result.data;
  const role = primaryOrganizationRole(member.role);
  if (member.organizationId !== expectedOrganizationId || !role) {
    return null;
  }
  return {
    id: member.id,
    organizationId: expectedOrganizationId,
    userId: member.userId,
    role,
  };
}

let organizationCache:
  | { token: string; organizations: AuthOrganization[]; cachedAt: number }
  | undefined;
let organizationRequest:
  { token: string; promise: Promise<AuthOrganization[]> } | undefined;
const ORGANIZATION_CACHE_KEY = "chief-auth-organizations";

function persistOrganizationCache() {
  const session = getStoredSession();
  if (!session || organizationCache?.token !== session.token) return;
  localStorage.setItem(
    ORGANIZATION_CACHE_KEY,
    JSON.stringify({
      userId: session.user.id,
      organizations: organizationCache.organizations,
      cachedAt: organizationCache.cachedAt,
    }),
  );
}

function restoreOrganizationCache() {
  const session = getStoredSession();
  if (!session || organizationCache?.token === session.token) return;
  try {
    const result = organizationCacheSchema.safeParse(
      JSON.parse(localStorage.getItem(ORGANIZATION_CACHE_KEY) ?? "null"),
    );
    if (result.success && result.data.userId === session.user.id) {
      organizationCache = {
        token: session.token,
        organizations: result.data.organizations,
        cachedAt: result.data.cachedAt,
      };
    }
  } catch {
    localStorage.removeItem(ORGANIZATION_CACHE_KEY);
  }
}

function invalidateOrganizationCache() {
  organizationCache = undefined;
  organizationRequest = undefined;
  localStorage.removeItem(ORGANIZATION_CACHE_KEY);
}

function cacheOrganization(organization: AuthOrganization) {
  const token = getStoredSession()?.token;
  if (!token) return;
  const organizations =
    organizationCache?.token === token
      ? organizationCache.organizations.filter(
          (candidate) => candidate.id !== organization.id,
        )
      : [];
  organizationCache = {
    token,
    organizations: [...organizations, organization],
    cachedAt: Date.now(),
  };
  persistOrganizationCache();
}

export function cachedAuthOrganization(organizationId: string | null) {
  restoreOrganizationCache();
  const token = getStoredSession()?.token;
  if (!organizationId || !token || organizationCache?.token !== token) {
    return null;
  }
  return (
    organizationCache.organizations.find(
      (organization) => organization.id === organizationId,
    ) ?? null
  );
}

export async function listAuthOrganizations(
  force = false,
  options: { throwOnError?: boolean } = {},
): Promise<AuthOrganization[]> {
  // Use direct fetch to the BetterAuth org list endpoint
  // rather than the authClient's organization plugin, which has
  // URL resolution issues in the Tauri desktop context.
  const storedSession = getStoredSession();
  if (!storedSession?.token) return [];
  const token = storedSession.token;
  restoreOrganizationCache();
  if (
    !force &&
    organizationCache?.token === token &&
    Date.now() - organizationCache.cachedAt < 30_000
  ) {
    return organizationCache.organizations;
  }
  let promise =
    !force && organizationRequest?.token === token
      ? organizationRequest.promise
      : undefined;

  if (!promise) {
    promise = (async () => {
      try {
        const url = `${AUTH_BASE_URL}/api/auth/organization/list`;
        const fetcher = isTauri() ? tauriFetch : fetch;
        const response = await fetchWithTimeout(fetcher, url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          throw new Error(`Organization request failed (${response.status})`);
        }

        const organizations = normalizeOrganizations(await response.json());
        organizationCache = {
          token,
          organizations,
          cachedAt: Date.now(),
        };
        persistOrganizationCache();
        return organizations;
      } finally {
        if (organizationRequest?.token === token) {
          organizationRequest = undefined;
        }
      }
    })();
    organizationRequest = { token, promise };
  }

  try {
    return await promise;
  } catch (error) {
    console.error("[Auth] listOrganizations error:", error);
    if (options.throwOnError) throw error;
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

interface AuthOrganizationUpdate<Metadata> {
  name?: string;
  logo?: string | null;
  metadata?: Metadata;
}

export async function updateAuthOrganization<Metadata>(
  organizationId: string,
  data: AuthOrganizationUpdate<Metadata>,
): Promise<void> {
  const storedSession = getStoredSession();
  if (!storedSession?.token) throw new Error("Not authenticated");

  const url = `${AUTH_BASE_URL}/api/auth/organization/update`;
  const fetcher = isTauri() ? tauriFetch : fetch;
  const normalizedData: AuthOrganizationUpdate<JsonObject> = {
    name: data.name,
    logo: data.logo,
    metadata:
      data.metadata === undefined ? undefined : toJsonObject(data.metadata),
  };
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${storedSession.token}`,
    },
    body: JSON.stringify({ organizationId, data: normalizedData }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to update organization: ${response.status} ${text}`,
    );
  }
  const cached = cachedAuthOrganization(organizationId);
  if (cached) cacheOrganization({ ...cached, ...normalizedData });
  else invalidateOrganizationCache();
}

export async function deleteAuthOrganization(
  organizationId: string,
): Promise<void> {
  const storedSession = getStoredSession();
  if (!storedSession?.token) throw new Error("Not authenticated");

  const url = `${AUTH_BASE_URL}/api/auth/organization/delete`;
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
      `Failed to delete organization: ${response.status} ${text}`,
    );
  }
  invalidateOrganizationCache();
}

export async function updateAuthUser(data: {
  name?: string;
  image?: string | null;
}): Promise<void> {
  const storedSession = getStoredSession();
  if (!storedSession?.token) throw new Error("Not authenticated");

  const url = `${AUTH_BASE_URL}/api/auth/update-user`;
  const fetcher = isTauri() ? tauriFetch : fetch;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${storedSession.token}`,
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to update profile: ${response.status} ${text}`);
  }
}

export async function createAuthOrganization(input: {
  name: string;
  slug: string;
  /** Optional logo URL persisted on the org record (better-auth `logo` field). */
  logo?: string;
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

  const result = authOrganizationSchema.safeParse(await response.json());
  if (!result.success) throw new Error("No organization returned");
  const responseData = result.data;
  cacheOrganization(responseData);
  return responseData;
}
