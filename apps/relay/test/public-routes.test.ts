import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { relayDiscoverySchema } from "@chief/relay-contracts";

import worker from "../src/index";

describe("public relay routes", () => {
  it("publishes health without authentication", async () => {
    const response = await worker.fetch(
      new Request("https://relay.test/health"),
      relayEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, protocolVersion: 1 });
  });

  it("publishes portable discovery", async () => {
    const response = await worker.fetch(
      new Request("https://relay.test/.well-known/chief-relay"),
      {
        ...relayEnv(),
        RELAY_PUBLIC_URL: undefined,
      },
      createExecutionContext(),
    );
    const body = relayDiscoverySchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      protocol: "chief-relay",
      protocolVersion: 1,
      deployment: relayEnv().RELAY_DEPLOYMENT,
      apiBaseUrl: "https://relay.test/v1",
    });
  });

  it("publishes secure tunnel URLs when local TLS terminates at a proxy", async () => {
    const response = await worker.fetch(
      new Request("http://relay-tunnel.example/.well-known/chief-relay", {
        headers: { "x-forwarded-proto": "https" },
      }),
      {
        ...relayEnv(),
        RELAY_PUBLIC_URL: undefined,
      },
      createExecutionContext(),
    );
    const body = relayDiscoverySchema.parse(await response.json());
    expect(body).toMatchObject({
      apiBaseUrl: "https://relay-tunnel.example/v1",
      websocketUrl: "wss://relay-tunnel.example/v1/connect",
    });
  });
});

function relayEnv(): Env {
  return {
    ...env,
    BETTER_AUTH_SECRET: "test-auth-secret",
    BOOTSTRAP_TOKEN_SHA256: "test-bootstrap-token",
    CLOUDFLARE_ACCOUNT_ID: "test-account",
    CLOUDFLARE_EMAIL_API_TOKEN: "test-email-token",
    EMAIL_FROM_ADDRESS: "test@example.test",
    EMAIL_FROM_NAME: "Chief Test",
    RELAY_SECRET_KEY: "test-relay-secret-master-key-0123456789abcdef",
  };
}
