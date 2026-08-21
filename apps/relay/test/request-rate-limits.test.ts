import { describe, expect, it, vi } from "vitest";

import {
  enforceEdgeRequestLimit,
  enforceIdentityRequestLimits,
  enforcePublicIdentityRequestLimit,
} from "../src/request-rate-limits";

describe("relay request rate limits", () => {
  it("keys broad protection by edge address before authentication", async () => {
    const edge = limiter(true);
    const relay = rateLimitEnv({ edge });

    await enforceEdgeRequestLimit(
      relay,
      new Request("https://relay.test/v1/workspaces", {
        headers: { "cf-connecting-ip": "203.0.113.8" },
      }),
    );

    expect(edge.limit).toHaveBeenCalledWith({ key: "203.0.113.8" });
  });

  it("applies both identity and ticket limits to socket ticket requests", async () => {
    const identity = limiter(true);
    const tickets = limiter(true);
    const relay = rateLimitEnv({ identity, tickets });

    await enforceIdentityRequestLimits(
      relay,
      new Request(
        "https://relay.test/v1/workspaces/workspace/conversations/general/socket-tickets",
      ),
      "device-key",
    );

    expect(identity.limit).toHaveBeenCalledWith({ key: "device-key" });
    expect(tickets.limit).toHaveBeenCalledWith({ key: "device-key" });
  });

  it("protects Better Auth before a request can reach D1", async () => {
    const auth = limiter(true);
    const relay = rateLimitEnv({ auth });

    await enforcePublicIdentityRequestLimit(
      relay,
      new Request("https://relay.test/api/auth/get-session", {
        headers: { "cf-connecting-ip": "203.0.113.9" },
      }),
    );

    expect(auth.limit).toHaveBeenCalledWith({ key: "203.0.113.9" });
  });

  it("strictly limits repeated device binding attempts", async () => {
    const device = limiter(true);
    const relay = rateLimitEnv({ device });

    await enforcePublicIdentityRequestLimit(
      relay,
      new Request("https://relay.test/v1/identity/device", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.10" },
      }),
    );

    expect(device.limit).toHaveBeenCalledWith({ key: "203.0.113.10" });
  });

  it("rejects excess traffic before downstream authority reads", async () => {
    const relay = rateLimitEnv({ identity: limiter(false) });

    await expect(
      enforceIdentityRequestLimits(
        relay,
        new Request("https://relay.test/v1/workspaces/workspace/channels"),
        "device-key",
      ),
    ).rejects.toMatchObject({
      status: 429,
      code: "rate_limit_exceeded",
    });
  });
});

function limiter(success: boolean) {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

function rateLimitEnv(input: {
  edge?: ReturnType<typeof limiter>;
  identity?: ReturnType<typeof limiter>;
  tickets?: ReturnType<typeof limiter>;
  auth?: ReturnType<typeof limiter>;
  device?: ReturnType<typeof limiter>;
}) {
  return {
    EDGE_REQUEST_RATE_LIMITER: input.edge ?? limiter(true),
    IDENTITY_REQUEST_RATE_LIMITER: input.identity ?? limiter(true),
    SOCKET_TICKET_RATE_LIMITER: input.tickets ?? limiter(true),
    AUTH_REQUEST_RATE_LIMITER: input.auth ?? limiter(true),
    DEVICE_BIND_RATE_LIMITER: input.device ?? limiter(true),
  } as unknown as Env;
}
