import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { MemoryDB } from "better-auth/adapters/memory";
import { memoryAdapter } from "better-auth/adapters/memory";
import { z } from "zod";

import { createChiefAuth } from "../src/server.js";

void test("an existing session confirms its account before authorization; signed queries reject tampering", async () => {
  const database: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    oauthClient: [],
    oauthConsent: [],
    jwks: [],
    oauthResource: [],
    oauthClientResource: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
  };
  const auth = createChiefAuth(
    {
      baseURL: "https://relay.example.com",
      uiOrigin: "https://app.example.com",
      secret: `${randomUUID()}${randomUUID()}`,
    },
    memoryAdapter(database),
  );
  const signup = await auth.handler(
    new Request("https://relay.example.com/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example.com",
      },
      body: JSON.stringify({
        name: "Test Person",
        email: "person@example.com",
        password: "a-safe-test-password",
      }),
    }),
  );
  assert.equal(signup.status, 200, await signup.clone().text());
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie);
  database.oauthClient?.push({
    id: "client",
    clientId: "chief-desktop",
    name: "Chief",
    redirectUris: ["https://app.example.com/auth/desktop"],
    scopes: ["openid", "profile", "email", "offline_access"],
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    tokenEndpointAuthMethod: "none",
    public: true,
    requirePKCE: true,
    skipConsent: true,
    disabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const query = new URLSearchParams({
    client_id: "chief-desktop",
    redirect_uri: "https://app.example.com/auth/desktop",
    response_type: "code",
    scope: "openid profile email offline_access",
    state: "test-state",
    code_challenge: createHash("sha256")
      .update("test-verifier-that-is-long-enough-for-pkce-validation")
      .digest("base64url"),
    code_challenge_method: "S256",
    resource: "https://relay.example.com",
  });
  const authorization = await auth.handler(
    new Request(
      `https://relay.example.com/api/auth/oauth2/authorize?${query}`,
      { headers: { cookie, accept: "application/json" } },
    ),
  );
  assert.equal(authorization.status, 200, await authorization.clone().text());
  const selection = new URL(
    z.object({ url: z.string() }).parse(await authorization.json()).url,
  );
  assert.equal(selection.pathname, "/sign-in");
  assert.equal(selection.searchParams.has("code"), false);
  assert.ok(selection.searchParams.get("sig"));
  const continueRequest = (oauth_query: string) =>
    auth.handler(
      new Request("https://relay.example.com/api/auth/oauth2/continue", {
        method: "POST",
        headers: {
          cookie,
          origin: "https://app.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ selected: true, oauth_query }),
      }),
    );
  const tampered = new URLSearchParams(selection.search);
  tampered.set("redirect_uri", "https://evil.example/callback");
  assert.equal((await continueRequest(tampered.toString())).status, 400);
  const continued = await continueRequest(selection.searchParams.toString());
  assert.equal(continued.status, 200, await continued.clone().text());
  const destination = new URL(
    z.object({ url: z.string() }).parse(await continued.json()).url,
  );
  assert.equal(destination.origin, "https://app.example.com");
  assert.equal(destination.pathname, "/auth/desktop");
  assert.equal(destination.searchParams.get("state"), "test-state");
  assert.ok(destination.searchParams.get("code"));
  const signout = await auth.handler(
    new Request("https://relay.example.com/api/auth/sign-out", {
      method: "POST",
      headers: { cookie, origin: "https://app.example.com" },
    }),
  );
  assert.equal(signout.status, 200);
  const signedOutContinuation = await continueRequest(
    selection.searchParams.toString(),
  );
  assert.notEqual(signedOutContinuation.status, 200);
});
