import { afterEach, describe, expect, it, vi } from "vitest";

import { hostedDurableTools } from "../src/hosted-agent-tools";
import { readWebPage } from "../src/hosted-agent-tools/toolkits/web";

describe("hosted web tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes lightweight public research without requiring a browser", () => {
    const read = hostedDurableTools({
      browserEnabled: false,
      computerEnabled: false,
    }).find((tool) => tool.definition.name === "web_read");

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

it("uses the selected workspace browser when a source rejects plain fetching", async () => {
  const open = vi.fn().mockResolvedValue({
    url: "https://example.com/public",
    title: "Rendered source",
    text: "Readable JavaScript page evidence.",
    controls: [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Blocked", { status: 403 })),
  );
  try {
    const { hostedWebTools } =
      await import("../src/hosted-agent-tools/toolkits/web");
    const read = hostedWebTools[0];
    if (!read) throw new Error("Missing web read tool");
    const context: Parameters<typeof read.execute>[0] = {
      env: {} as Env,
      job: {
        id: "selected-browser-fallback",
        workspaceId: "test",
        agentId: "prospector",
        payload: {},
      } as Parameters<typeof read.execute>[0]["job"],
      principal: {} as Parameters<typeof read.execute>[0]["principal"],
      browser: {
        open,
        snapshot: open,
        click: open,
        type: open,
        select: open,
        screenshot: vi.fn().mockResolvedValue(new Uint8Array()),
        close: vi.fn().mockResolvedValue(undefined),
      },
      computer: {} as Parameters<typeof read.execute>[0]["computer"],
      computerEnabled: false,
    };
    const result = await read.execute(context, {
      url: "https://example.com/public",
    });
    expect(open).toHaveBeenCalledWith("https://example.com/public");
    expect(result).toMatchObject({
      title: "Rendered source",
      text: "Readable JavaScript page evidence.",
      browserUsed: true,
      status: "loaded",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
