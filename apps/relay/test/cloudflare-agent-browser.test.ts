import { describe, expect, it } from "vitest";

import { isTransientBrowserNavigationError } from "../src/cloudflare-agent-browser";

describe("CloudflareAgentBrowser", () => {
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
