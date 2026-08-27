import { describe, expect, it } from "vitest";

import { relayCapacityResponse } from "../src/relay-capacity";

describe("relay capacity errors", () => {
  it.each([
    "Exceeded allowed duration in Durable Objects free tier.",
    "Exceeded allowed volume of requests in Durable Objects free tier.",
  ])("turns %s into a retryable response", async (message) => {
    const response = relayCapacityResponse(new Error(message), "request-1");

    expect(response?.status).toBe(503);
    const retryAfter = Number(response?.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
    await expect(response?.json()).resolves.toMatchObject({
      error: {
        code: "relay_capacity_exhausted",
        requestId: "request-1",
      },
    });
  });

  it("does not relabel unrelated failures", () => {
    expect(relayCapacityResponse(new Error("database unavailable"))).toBe(
      undefined,
    );
  });
});
