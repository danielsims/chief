import { describe, expect, it } from "vitest";

import {
  browserAcquisitionDelay,
  isTransientBrowserNavigationError,
} from "../src/cloudflare-agent-browser";

describe("CloudflareAgentBrowser", () => {
  it("defers for Cloudflare's full browser acquisition window", () => {
    expect(
      browserAcquisitionDelay({
        activeSessions: [],
        maxConcurrentSessions: 3,
        allowedBrowserAcquisitions: 0,
        timeUntilNextAllowedBrowserAcquisition: 19_500,
      }),
    ).toBe(19_500);
  });

  it("defers while all browser sessions are occupied", () => {
    expect(
      browserAcquisitionDelay({
        activeSessions: [{ id: "one" }, { id: "two" }, { id: "three" }],
        maxConcurrentSessions: 3,
        allowedBrowserAcquisitions: 1,
        timeUntilNextAllowedBrowserAcquisition: 0,
      }),
    ).toBe(5_000);
  });

  it("recognizes a page navigation race as transient", () => {
    expect(
      isTransientBrowserNavigationError(
        new Error(
          "Execution context was destroyed, most likely because of a navigation.",
        ),
      ),
    ).toBe(true);
    expect(
      isTransientBrowserNavigationError(new Error("Selector missing")),
    ).toBe(false);
  });
});
