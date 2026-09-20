import assert from "node:assert/strict";
import test from "node:test";

import { createChiefAuth } from "../src/server.js";

void test("in-app account deletion is enabled without a freshness window", async () => {
  const auth = createChiefAuth(
    {
      apple: {
        appBundleIdentifier: "sh.heychief.mobile",
        clientId: "sh.heychief.web",
        clientSecret: "apple-client-secret",
      },
      baseURL: "https://relay.example.com",
      secret: "test-auth-secret-test-auth-secret",
      uiOrigin: "https://app.example.com",
    },
    () => ({ id: "unused" }) as never,
  );

  assert.equal(auth.options.user.deleteUser.enabled, true);
  assert.equal(auth.options.session.freshAge, 0);
  const apple = auth.options.socialProviders.apple;
  assert.ok(apple);
  assert.equal(apple.appBundleIdentifier, "sh.heychief.mobile");
  assert.deepEqual(apple.audience, ["sh.heychief.web", "sh.heychief.mobile"]);
  await auth.$context.then(
    () => undefined,
    () => undefined,
  );
});
