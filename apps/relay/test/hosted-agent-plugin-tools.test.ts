import { afterEach, describe, expect, it, vi } from "vitest";

import { hostedPluginCatalog } from "../src/hosted-agent-plugin-tools";

describe("hosted agent plugin catalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps relevant plugins that appear beyond the first catalog page", async () => {
    const entries = Array.from({ length: 75 }, (_, index) => ({
      slug: `plugin-${index}`,
      name: `Plugin ${index}`,
      domain: `plugin-${index}.example`,
      description: `Catalog plugin ${index}`,
      kind: "mcp",
    }));
    entries.push({
      slug: "needle",
      name: "Needle",
      domain: "noodleseed.com",
      description: "Find potential customers across public social networks.",
      kind: "mcp",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: entries }), { status: 200 }),
      ),
    );

    const catalog = await hostedPluginCatalog();

    expect(catalog.find((plugin) => plugin.id === "needle")).toMatchObject({
      name: "Needle",
      domain: "noodleseed.com",
    });
  });
});
