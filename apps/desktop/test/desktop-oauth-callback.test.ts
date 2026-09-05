import assert from "node:assert/strict";
import test from "node:test";

import { parseChiefDeepLink } from "../src/lib/app-navigation";
import { isDesktopOAuthCallback } from "../src/lib/auth/oauth-loopback";

void test("treats custom-scheme auth responses as OAuth callbacks", () => {
  assert.equal(
    isDesktopOAuthCallback("chief-desktop:///auth?code=abc&state=def"),
    true,
  );
  assert.equal(
    isDesktopOAuthCallback("chief-desktop:///auth?error=access_denied"),
    true,
  );
  assert.equal(isDesktopOAuthCallback("chief-desktop://navigate/inbox"), false);
});

void test("does not treat an OAuth callback as in-app navigation", () => {
  assert.equal(
    parseChiefDeepLink("chief-desktop:///auth?code=abc&state=def"),
    null,
  );
  assert.equal(
    parseChiefDeepLink("chief-desktop://auth?code=abc&state=def"),
    null,
  );
});
