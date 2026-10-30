import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";

import { executionLeaseSchema } from "@chief/relay-contracts";

import { BrowserRegistry } from "../src/browser-registry";
import { readConfig } from "../src/config";
import { createExecutorHandler } from "../src/handler";

void test("browser-only machines deny files and processes with a full capability lease", async () => {
  const secret = "browser-only-test-secret-value-32-characters";
  const config = readConfig({
    COMPUTER_PUBLIC_URL: "http://localhost:8789",
    COMPUTER_BROWSER_ENCRYPTION_KEY: secret,
    COMPUTER_BROWSER_STREAM_SECRET: secret,
    COMPUTER_AUTH_SECRET: secret,
    EXECUTOR_AUTH_ISSUER: "https://relay.internal",
    EXECUTOR_AUTH_AUDIENCE: "chief-computer",
    EXECUTOR_BROWSER_ONLY: "true",
    BROWSER_CDP_URL: "9222",
    LISTEN_HOST: "127.0.0.1",
  });
  const lease = executionLeaseSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: "test",
    agentId: "test",
    placementEpoch: 1,
    capabilities: [
      "process:exec",
      "filesystem:read",
      "filesystem:write",
      "browser:use",
      "network:egress",
    ],
    resources: {
      cpuMillis: 1000,
      memoryMib: 1024,
      diskMib: 2048,
      wallTimeSeconds: 60,
    },
    network: { mode: "deny", allowedHosts: [] },
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  const token = await new SignJWT({ lease })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("https://relay.internal")
    .setAudience("chief-computer")
    .setExpirationTime("1m")
    .sign(new TextEncoder().encode(secret));
  const browsers = new BrowserRegistry(config);
  const handler = createExecutorHandler(config, browsers);
  assert.equal(config.BROWSER_CDP_URL, "9222");
  assert.equal(
    (await handler(new Request("http://localhost/health"))).status,
    200,
  );
  for (const endpoint of [
    "exec",
    "files/read",
    "files/write",
    "files/list",
    "files/remove",
  ]) {
    const response = await handler(
      new Request(`http://localhost/v1/${endpoint}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: "{}",
      }),
    );
    assert.equal(response.status, 403, endpoint);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "browser_only");
  }
  browsers.click = () => {
    throw new Error(
      JSON.stringify({
        error:
          "Element @e33 is covered by a dialog. Dismiss the covering element first.",
        data: null,
      }),
    );
  };
  const failedClick = await handler(
    new Request("http://localhost/v1/browser/click", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: "e33" }),
    }),
  );
  const failure = (await failedClick.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(failedClick.status, 500);
  assert.equal(failure.error.code, "browser_interaction_failed");
  assert.match(failure.error.message, /covered by a dialog/u);
  assert.doesNotMatch(failure.error.message, /"data"/u);
});
