import assert from "node:assert/strict";
import test from "node:test";

import { safeAuthorizationRedirect } from "./authorization-redirect";

void test("allows native callbacks on arbitrary loopback ports", () => {
  for (const port of [49152, 62347]) {
    const uri = `http://127.0.0.1:${port}/auth/desktop?code=test&state=test`;
    assert.equal(safeAuthorizationRedirect(uri, "https://heychief.sh"), uri);
  }
});

void test("rejects lookalike hosts, unrelated paths, and URL credentials", () => {
  for (const uri of [
    "http://127.0.0.1.evil.example:49152/auth/desktop",
    "http://127.0.0.1:49152/other",
    "http://127.0.0.1:0/auth/desktop",
    "http://user@127.0.0.1:49152/auth/desktop",
    "https://evil.example/auth/desktop",
  ]) {
    assert.equal(safeAuthorizationRedirect(uri, "https://heychief.sh"), null);
  }
});

void test("preserves first-party and existing native handoffs", () => {
  for (const uri of [
    "https://heychief.sh/sign-in",
    "https://heychief.sh/auth/desktop?code=test&state=test",
    "chief-desktop:///auth?code=test&state=test",
    "chief-mobile://auth?code=test&state=test",
  ]) {
    assert.equal(safeAuthorizationRedirect(uri, "https://heychief.sh"), uri);
  }
});
