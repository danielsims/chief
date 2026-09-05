import assert from "node:assert/strict";
import test from "node:test";

import type { StoredSession } from "../src/lib/auth/session";
import {
  ACCESS_TOKEN_REFRESH_LEAD_MS,
  adoptRefreshedSession,
  createOAuthRefreshGate,
  nextAccessTokenRefreshDelay,
  resolveStoredOAuthSession,
  sessionNeedsAccessTokenRefresh,
} from "../src/lib/auth/oauth-session-refresh";
import { OAuthTokenError } from "../src/lib/auth/oauth-token-error";

const user: StoredSession["user"] = {
  id: "user-1",
  name: "Ada",
  email: "ada@example.com",
  emailVerified: true,
};

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    token: "access-1",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 15 * 60_000,
    user,
    lastValidated: Date.now(),
    ...overrides,
  };
}

void test("refreshes while the access token is still inside the lead window", () => {
  const now = 1_000_000;
  assert.equal(
    sessionNeedsAccessTokenRefresh(
      session({ expiresAt: now + ACCESS_TOKEN_REFRESH_LEAD_MS }),
      now,
    ),
    true,
  );
  assert.equal(
    sessionNeedsAccessTokenRefresh(
      session({ expiresAt: now + ACCESS_TOKEN_REFRESH_LEAD_MS + 1 }),
      now,
    ),
    false,
  );
  assert.equal(
    nextAccessTokenRefreshDelay(now + 15 * 60_000, now),
    15 * 60_000 - ACCESS_TOKEN_REFRESH_LEAD_MS,
  );
});

void test("coalesces concurrent refreshes of the same rotating credential", async () => {
  let calls = 0;
  let release!: (value: StoredSession) => void;
  const refresh = createOAuthRefreshGate(
    () =>
      new Promise<StoredSession>((resolve) => {
        calls += 1;
        release = resolve;
      }),
  );
  const current = session();
  const first = refresh(current);
  const second = refresh(current);
  const next = session({
    token: "access-2",
    refreshToken: "refresh-2",
  });
  release(next);
  assert.equal(await first, next);
  assert.equal(await second, next);
  assert.equal(calls, 1);
});

void test("keeps a newer persisted refresh token when a stale refresh completes", () => {
  const started = session();
  const latest = session({
    token: "access-3",
    refreshToken: "refresh-3",
  });
  const stale = session({
    token: "access-2",
    refreshToken: "refresh-2",
  });
  assert.equal(adoptRefreshedSession(latest, started, stale), latest);
  assert.equal(adoptRefreshedSession(null, started, stale), stale);
});

void test("overlapping near-expiry checks share one refresh instead of signing out", async () => {
  let calls = 0;
  const current = session({
    expiresAt: Date.now() + 30_000,
  });
  const next = session({
    token: "access-2",
    refreshToken: "refresh-2",
    expiresAt: Date.now() + 15 * 60_000,
  });
  const refresh = createOAuthRefreshGate(async () => {
    calls += 1;
    await Promise.resolve();
    return next;
  });
  const [first, second] = await Promise.all([
    resolveStoredOAuthSession(current, {
      refresh,
      validate: () => Promise.resolve({ status: "invalid" as const }),
    }),
    resolveStoredOAuthSession(current, {
      refresh,
      validate: () => Promise.resolve({ status: "invalid" as const }),
    }),
  ]);
  assert.equal(first, next);
  assert.equal(second, next);
  assert.equal(calls, 1);
});

void test("a 4xx refresh rejection still signs out when this is the live credential", async () => {
  const current = session({ expiresAt: Date.now() - 1_000 });
  const result = await resolveStoredOAuthSession(current, {
    refresh: () => Promise.reject(new OAuthTokenError("invalid grant", 400)),
    validate: () => Promise.resolve({ status: "invalid" as const }),
  });
  assert.equal(result, null);
});
