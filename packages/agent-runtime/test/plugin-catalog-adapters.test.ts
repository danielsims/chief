import assert from "node:assert/strict";
import test from "node:test";

import {
  mergePluginCatalogEntries,
  parseAgentCatalog,
  parseIntegrationsCatalog,
} from "../src/plugins/catalog-adapters";

void test("parses only pinned remote entries from an Agent Plugin catalog", () => {
  const entries = parseAgentCatalog("test-catalog", {
    plugins: [
      {
        name: "deploy-tools",
        description: "Deploy applications.",
        category: "deployment",
        source: {
          source: "url",
          url: "https://github.com/example/deploy-tools.git",
          sha: "a".repeat(40),
        },
      },
      {
        name: "moving-target",
        description: "Not reproducible.",
        source: { source: "url", url: "https://github.com/example/latest.git" },
      },
    ],
  });
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.ok(entry);
  assert.equal(entry.id, "deploy-tools");
  assert.equal(entry.catalogId, "test-catalog");
  assert.equal(entry.source.type, "git");
});

void test("turns MCP surfaces into discoverable plugin entries", () => {
  const entries = parseIntegrationsCatalog({
    data: [
      {
        kind: "mcp",
        slug: "posthog",
        name: "PostHog",
        description: "Product analytics and feature management.",
        domain: "posthog.com",
        categories: ["analytics"],
        popularity: 20_000,
      },
      {
        kind: "openapi",
        slug: "posthog-api",
        name: "PostHog API",
        description: "REST API.",
        domain: "posthog.com",
      },
    ],
  });
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.ok(entry);
  assert.equal(entry.name, "PostHog");
  assert.equal(entry.category, "analytics");
  assert.equal(entry.featured, true);
  assert.equal(entry.popularity, 20_000);
  assert.deepEqual(entry.source, {
    type: "discovery",
    registry: "integrations.sh",
    domain: "posthog.com",
  });
});

void test("uses product names for machine-named catalog surfaces", () => {
  const [entry] = parseIntegrationsCatalog({
    data: [
      {
        kind: "mcp",
        slug: "gmail-googleapis-com",
        name: "gmail.googleapis.com",
        description: "Read and manage Gmail messages.",
        domain: "gmail.googleapis.com",
        categories: [],
      },
    ],
  });
  assert.equal(entry?.name, "Gmail");
});

void test("prefers a hosted provider connector over a same-id Git package", () => {
  const [hosted] = parseIntegrationsCatalog({
    data: [
      {
        kind: "mcp",
        slug: "vercel",
        name: "Vercel",
        description: "Connect directly to Vercel.",
        domain: "vercel.com",
      },
    ],
  });
  const [git] = parseAgentCatalog("xai", {
    plugins: [
      {
        name: "vercel",
        description: "A downloadable Vercel package.",
        source: {
          url: "https://github.com/vercel/vercel-plugin.git",
          sha: "a".repeat(40),
        },
      },
    ],
  });
  assert.ok(hosted && git);
  assert.equal(
    mergePluginCatalogEntries([git, hosted])[0]?.source.type,
    "discovery",
  );
  assert.equal(
    mergePluginCatalogEntries([hosted, git])[0]?.source.type,
    "discovery",
  );
});

void test("prefers a vetted bundled connector over catalog discovery", () => {
  const discovered = parseIntegrationsCatalog({
    data: [
      {
        kind: "mcp",
        slug: "github",
        name: "GitHub",
        description: "A discovered GitHub endpoint.",
        domain: "github.com",
      },
    ],
  })[0];
  assert.ok(discovered);
  const bundled = {
    ...discovered,
    source: { type: "bundled" as const, path: "/plugins/github" },
    catalogId: "chief-bundled",
  };
  assert.equal(
    mergePluginCatalogEntries([discovered, bundled])[0]?.source.type,
    "bundled",
  );
  assert.equal(
    mergePluginCatalogEntries([bundled, discovered])[0]?.source.type,
    "bundled",
  );
});
