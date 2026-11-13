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

void test("unbundled desktop returns directly to its reserved loopback listener", () => {
  assert.equal(
    desktopAuthorizationRedirectUri(
      "http://localhost:8080",
      "http://127.0.0.1:49152/auth/desktop",
    ),
    "http://127.0.0.1:49152/auth/desktop",
  );
  for (const uri of [
    "http://127.0.0.1.evil.test:49152/auth/desktop",
    "http://127.0.0.1:0/auth/desktop",
    "http://127.0.0.1:49152/other",
    "http://user@127.0.0.1:49152/auth/desktop",
    "http://127.0.0.1:49152/auth/desktop?code=stale",
  ]) {
    assert.throws(() =>
      desktopAuthorizationRedirectUri("http://localhost:8080", uri),
    );
  }
});
