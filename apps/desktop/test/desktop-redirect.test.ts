import assert from "node:assert/strict";
import test from "node:test";

import { desktopAuthorizationRedirectUri } from "../src/lib/auth/desktop-redirect";

void test("desktop sign-in returns through an HTTPS page instead of a custom scheme", () => {
  assert.equal(
    desktopAuthorizationRedirectUri("https://heychief.sh"),
    "https://heychief.sh/auth/desktop",
  );
  assert.equal(
    desktopAuthorizationRedirectUri("http://localhost:3000"),
    "http://localhost:3000/auth/desktop",
  );
});
