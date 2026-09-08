import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPkceVerifier,
  generateState,
  getPkceAttempt,
  storePkceVerifier,
} from "../src/lib/auth/pkce";

void test("retains the relay and auth endpoint that started a PKCE flow", async () => {
  const state = generateState();

  await storePkceVerifier(state, "v".repeat(43), {
    relayOrigin: "https://relay.example",
    authBaseUrl: "https://accounts.example",
    redirectUri: "http://localhost:3000/auth/desktop",
  });

  const attempt = await getPkceAttempt(state);
  assert.ok(attempt);
  assert.equal(attempt.state, state);
  assert.equal(attempt.relayOrigin, "https://relay.example");
  assert.equal(attempt.authBaseUrl, "https://accounts.example");
  assert.equal(attempt.redirectUri, "http://localhost:3000/auth/desktop");
});

void test("clears a completed PKCE attempt so a sticky callback is ignored", async () => {
  const state = generateState();

  await storePkceVerifier(state, "v".repeat(43), {
    relayOrigin: "http://localhost:8080",
    authBaseUrl: "http://localhost:8080",
    redirectUri: "http://localhost:3000/auth/desktop",
  });
  await clearPkceVerifier(state);

  assert.equal(await getPkceAttempt(state), null);
});
