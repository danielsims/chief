import assert from "node:assert/strict";
import test from "node:test";

import { relayCookiePrefix } from "../src/cookie-prefix.js";
import { trustedOrigins } from "../src/origins.js";

void test("relay cookie namespaces include the complete authority origin", () => {
  const first = relayCookiePrefix("http://localhost:8080");
  const second = relayCookiePrefix("http://localhost:9090");

  assert.notEqual(first, second);
  assert.equal(first, relayCookiePrefix("http://localhost:8080/path"));
  assert.match(first, /^[a-z\d_]+$/u);
});

void test("trusted origins include Apple only when that provider is configured", () => {
  const withoutApple = trustedOrigins({
    baseURL: "https://relay.example.com",
    uiOrigin: "https://app.example.com",
  });
  const withApple = trustedOrigins({
    apple: {
      clientId: "sh.example.chief.web",
      clientSecret: "apple-client-secret",
    },
    baseURL: "https://relay.example.com",
    uiOrigin: "https://app.example.com",
  });

  assert.equal(withoutApple.includes("https://appleid.apple.com"), false);
  assert.equal(withApple.includes("https://appleid.apple.com"), true);
});
