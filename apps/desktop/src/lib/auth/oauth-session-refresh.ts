import { isJsonNumber } from "@chief/relay-contracts";

import type { StoredSession } from "./session";
import { shouldInvalidateOAuthSession } from "./oauth-token-error";

/** Refresh before the 15-minute access token dies, without waiting for focus. */
export const ACCESS_TOKEN_REFRESH_LEAD_MS = 120_000;

export function sessionNeedsAccessTokenRefresh(
  session: Pick<StoredSession, "refreshToken" | "expiresAt"> | null | undefined,
  now = Date.now(),
) {
  if (!session?.refreshToken || !isJsonNumber(session.expiresAt)) return false;
  return session.expiresAt <= now + ACCESS_TOKEN_REFRESH_LEAD_MS;
}

export function nextAccessTokenRefreshDelay(
  expiresAt: number,
  now = Date.now(),
) {
  return expiresAt - ACCESS_TOKEN_REFRESH_LEAD_MS - now;
}

/**
 * Refresh tokens rotate. A later in-flight refresh must not overwrite a newer
 * credential that another caller already persisted.
 */
export function adoptRefreshedSession(
  latest: StoredSession | null,
  startedFrom: StoredSession,
  refreshed: StoredSession,
): StoredSession {
  if (
    latest?.refreshToken &&
    latest.refreshToken !== startedFrom.refreshToken &&
    latest.refreshToken !== refreshed.refreshToken
  ) {
    return latest;
  }
  return refreshed;
}

/**
 * Better Auth revokes the previous refresh token and, on reuse, invalidates
 * the whole family. Concurrent callers must share one in-flight refresh.
 */
export function createOAuthRefreshGate(
  refresh: (session: StoredSession) => Promise<StoredSession>,
) {
  let inFlight: {
    refreshToken: string;
    promise: Promise<StoredSession>;
  } | null = null;

  return (session: StoredSession) => {
    const refreshToken = session.refreshToken?.trim();
    if (!refreshToken) return refresh(session);
    if (inFlight?.refreshToken === refreshToken) return inFlight.promise;
    const promise = refresh(session).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { refreshToken, promise };
    return promise;
  };
}

export function asError(value: Error | string): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function resolveStoredOAuthSession(
  session: StoredSession,
  input: {
    now?: () => number;
    refresh: (session: StoredSession) => Promise<StoredSession>;
    validate: (token: string) => Promise<
      | {
          status: "valid";
          user: StoredSession["user"];
          organizationId?: string;
        }
      | { status: "invalid" }
      | { status: "unknown" }
    >;
  },
): Promise<StoredSession | null> {
  const now = input.now ?? Date.now;
  if (sessionNeedsAccessTokenRefresh(session, now())) {
    try {
      return await input.refresh(session);
    } catch (error) {
      return shouldInvalidateOAuthSession(
        asError(error instanceof Error ? error : String(error)),
      )
        ? null
        : session;
    }
  }
  const validation = await input.validate(session.token);
  if (validation.status === "valid") {
    return {
      ...session,
      user: validation.user,
      organizationId: validation.organizationId ?? session.organizationId,
      lastValidated: now(),
    };
  }
  if (validation.status === "unknown") return session;
  if (!session.refreshToken) return null;
  try {
    return await input.refresh(session);
  } catch (error) {
    return shouldInvalidateOAuthSession(
      asError(error instanceof Error ? error : String(error)),
    )
      ? null
      : session;
  }
}
