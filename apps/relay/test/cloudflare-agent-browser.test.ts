import { describe, expect, it } from "vitest";

import { browserAcquisitionDelay } from "../src/cloudflare-agent-browser";

describe("Cloudflare browser acquisition", () => {
  it("reports Cloudflare's full browser acquisition wait window", () => {
    expect(
      browserAcquisitionDelay({
        activeSessions: [],
        maxConcurrentSessions: 3,
        allowedBrowserAcquisitions: 0,
        timeUntilNextAllowedBrowserAcquisition: 19_500,
      }),
    ).toBe(19_500);
  });

  it("reports a wait while all browser sessions are occupied", () => {
    expect(
      browserAcquisitionDelay({
        activeSessions: [{ id: "one" }, { id: "two" }, { id: "three" }],
        maxConcurrentSessions: 3,
        allowedBrowserAcquisitions: 1,
        timeUntilNextAllowedBrowserAcquisition: 0,
      }),
    ).toBe(5_000);
  });
});
