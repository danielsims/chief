import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
      relayEnv(),
      createExecutionContext(),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      protocol: "chief-relay",
      protocolVersion: 1,
      deployment: relayEnv().RELAY_DEPLOYMENT,
      apiBaseUrl: "https://relay.test/v1",
    });
  });
});

function relayEnv(): Parameters<typeof worker.fetch>[1] {
  return env as unknown as Parameters<typeof worker.fetch>[1];
}
