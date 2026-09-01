import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchVerifiedEveEndpoint,
  requireVerifiedEveEndpoint,
} from "../src/external-agent-channel-security";

afterEach(() => vi.unstubAllGlobals());

describe("external agent channel egress", () => {
  it.each([
    "https://[::1]/channel",
    "https://[fc00::1]/channel",
    "https://[fe80::1]/channel",
    "https://[::ffff:127.0.0.1]/channel",
    "https://127.0.0.1/channel",
  ])("rejects non-Eve address %s", (endpoint) => {
    expect(() => requireVerifiedEveEndpoint(endpoint)).toThrow();
  });

  it("rejects redirects without following or forwarding authorization", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 307,
        headers: { location: "https://127.0.0.1/steal" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchVerifiedEveEndpoint("https://chief-agent.vercel.app/channel", {
        headers: { authorization: "Bearer secret" },
      }),
    ).rejects.toThrow("redirects are not permitted");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
