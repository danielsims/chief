import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { relayTestEnv } from "./helpers";

describe("router error boundary", () => {
  it("returns a relay error when device binding authentication is malformed", async () => {
    const response = await worker.fetch(
      new Request("https://relay.test/v1/identity/device", {
        method: "POST",
        headers: {
          authorization: "Nostr invalid",
          "content-type": "application/json",
        },
        body: JSON.stringify({ accountToken: `chief_at_${"a".repeat(34)}` }),
      }),
      relayTestEnv(),
      createExecutionContext(),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "unauthenticated" },
    });
  });
});
