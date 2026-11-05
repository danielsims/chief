import { describe, expect, it, vi } from "vitest";

import { publishesBrowserSession } from "../src/agent-hosted-activity";
import { googleBrowserSearch } from "../src/hosted-agent-tools/toolkits/web";

const snapshot = {
  url: "https://www.google.com/search?q=browser",
  title: "browser - Google Search",
  text: "- link Example [ref=e1]",
  controls: ["- link Example [ref=e1]"],
};

describe("browser-only browsing", () => {
  it("publishes the browser session after Google search for human handoff", () => {
    expect(publishesBrowserSession("web_search")).toBe(true);
    expect(publishesBrowserSession("browser_open")).toBe(true);
    expect(publishesBrowserSession("browser_close")).toBe(true);
    expect(publishesBrowserSession("web_read")).toBe(false);
    expect(publishesBrowserSession("web_read", { browserUsed: true })).toBe(
      true,
    );
  });
  it("searches Google through browser navigation, with no alternate-engine request", async () => {
    const open = vi.fn().mockResolvedValue(snapshot);
    const result = await googleBrowserSearch({ open }, "automation & workflow");
    expect(open).toHaveBeenCalledOnce();
    const url = new URL(String(open.mock.calls[0]?.[0]));
    expect(url.hostname).toBe("www.google.com");
    expect(url.searchParams.get("q")).toBe("automation & workflow");
    expect(result).toMatchObject({ engine: "google", status: "loaded" });
  });

  it("reports verification without retrying or changing engines", async () => {
    const open = vi.fn().mockResolvedValue({
      ...snapshot,
      url: "https://www.google.com/sorry/index",
      text: "Why did this happen?",
    });
    const result = await googleBrowserSearch({ open }, "automation");
    expect(result.status).toBe("verification_required");
    expect(result.action).toContain("Ask the user");
    expect(open).toHaveBeenCalledOnce();
  });

  it("does not mistake a JavaScript bootstrap page for usable results", async () => {
    const result = await googleBrowserSearch(
      { open: async () => ({ ...snapshot, text: "Please enable JavaScript" }) },
      "automation",
    );
    expect(result.status).toBe("javascript_required");
  });
});
