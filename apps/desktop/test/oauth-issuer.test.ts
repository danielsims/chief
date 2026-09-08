import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOAuthIssuer,
  oauthIssuerMatches,
  resolveOAuthIssuer,
} from "../src/lib/auth/oauth-issuer";

void test("accepts the canonical issuer declared by an auth proxy", async () => {
  const fetcher = () =>
    Promise.resolve(
      Response.json({
        issuer: "https://relay.example/api/auth",
      }),
    );

  assert.equal(
    await resolveOAuthIssuer("https://heychief.example", fetcher),
    "https://relay.example/api/auth",
  );
  assert.equal(
    await oauthIssuerMatches(
      "https://relay.example/api/auth",
      "https://heychief.example",
      fetcher,
    ),
    true,
  );
});

void test("falls back to the requested auth origin when discovery is unavailable", async () => {
  const fetcher = () => Promise.resolve(new Response(null, { status: 503 }));

  assert.equal(
    await resolveOAuthIssuer("https://relay.example", fetcher),
    "https://relay.example/api/auth",
  );
});

void test("rejects insecure, credentialed, and non-auth issuer URLs", () => {
  for (const issuer of [
    "http://relay.example/api/auth",
    "https://user:password@relay.example/api/auth",
    "https://relay.example/not-auth",
  ]) {
    assert.throws(() => normalizeOAuthIssuer(issuer), /invalid OAuth issuer/u);
  }
});
