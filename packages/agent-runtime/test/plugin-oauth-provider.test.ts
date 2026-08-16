import assert from "node:assert/strict";
import test from "node:test";

import type { StoredOAuthSession } from "../src/plugins/oauth-provider";
import { oauthConnectionStatus } from "../src/plugins/oauth-provider";

function session(
  overrides: Partial<StoredOAuthSession> = {},
): StoredOAuthSession {
  return {
    version: 1,
    serverUrl: "https://example.com/mcp",
    state: "state",
    authorizedWithoutTokens: true,
    updatedAt: Date.now(),
    ...overrides,
  };
}

void test("a multi-server plugin connects only after every server is ready", () => {
  assert.equal(
    oauthConnectionStatus([session(), undefined]),
    "authorization_required",
  );
  assert.equal(oauthConnectionStatus([session(), session()]), "connected");
});

void test("an expired server makes the whole plugin reconnect", () => {
  assert.equal(
    oauthConnectionStatus([
      session(),
      session({
        authorizedWithoutTokens: false,
        tokens: {
          access_token: "expired",
          token_type: "bearer",
          expires_in: 1,
        },
        updatedAt: Date.now() - 60_000,
      }),
    ]),
    "reconnect",
  );
});
