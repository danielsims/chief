import { describe, expect, it } from "vitest";

import { relayCapacityResponse } from "../src/relay-capacity";

describe("relay capacity errors", () => {
  it("turns a Durable Objects free-tier exhaustion into a retryable response", async () => {
    const response = relayCapacityResponse(
      new Error(
        "Exceeded allowed volume of requests in Durable Objects free tier.",
      ),
      "request-1",
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("3600");
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
