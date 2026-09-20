import assert from "node:assert/strict";
import test from "node:test";

import { storedOAuthAccessToken } from "../src/oauth-access-session.js";
import { appleProviderConfig } from "../src/options.js";

void test("Apple identity tokens accept both the Services ID and the iOS bundle", () => {
  const configured = appleProviderConfig({
    appBundleIdentifier: "sh.heychief.mobile",
    clientId: "sh.heychief.web",
    clientSecret: "apple-client-secret",
  });

  assert.deepEqual(configured.audience, [
    "sh.heychief.web",
    "sh.heychief.mobile",
  ]);
});

void test("opaque OAuth access tokens are stored without the public prefix", () => {
  assert.equal(storedOAuthAccessToken("chief_at_abc123"), "abc123");
  assert.equal(storedOAuthAccessToken("session-token"), null);
});
