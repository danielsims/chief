import assert from "node:assert/strict";
import test from "node:test";

import {
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
  assert.deepEqual(entry.source, {
    type: "discovery",
    registry: "integrations.sh",
    domain: "posthog.com",
  });
});
