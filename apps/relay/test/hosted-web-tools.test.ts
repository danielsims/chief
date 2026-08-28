import { afterEach, describe, expect, it, vi } from "vitest";

import { hostedDurableTools } from "../src/hosted-agent-tools";
import { readWebPage } from "../src/hosted-agent-tools/toolkits/web";

describe("hosted web tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes lightweight public research without requiring a browser", () => {
    const read = hostedDurableTools(false).find(
      (tool) => tool.definition.name === "web_read",
    );

    expect(read?.effect).toBe("read_only");
  });

  it("extracts bounded readable content and links from HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            '<html><head><title>Acme &amp; Co</title><script>ignore()</script></head><body><h1>Build faster</h1><p>Useful evidence.</p><a href="/about">About</a></body></html>',
            { headers: { "content-type": "text/html" } },
          ),
        ),
      ),
    );

    await expect(readWebPage("https://acme.example")).resolves.toEqual({
      url: "https://acme.example/",
      title: "Acme & Co",
      text: "Build faster\nUseful evidence.\nAbout",
      links: ["https://acme.example/about"],
    });
  });

  it("rejects private network targets before making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(readWebPage("http://127.0.0.1:8080")).rejects.toThrow(
      "public HTTP or HTTPS",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
