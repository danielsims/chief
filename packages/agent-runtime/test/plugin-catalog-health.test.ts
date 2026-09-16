import assert from "node:assert/strict";
import test from "node:test";

import type { RemotePluginCatalogEntry } from "../src/plugins/types.js";
import {
  auditPluginCatalog,
  classifyPluginAuthorization,
  integrationsSurfaceUrl,
  oauthAuthorizationServerUrl,
  oauthProtectedResourceUrl,
} from "../src/plugins/catalog-health.js";

function requiredCatalogUrl(url: string | undefined) {
  assert.ok(url);
  return url;
}

const granola: RemotePluginCatalogEntry = {
  id: "granola",
  name: "Granola",
  description: "Meeting notes.",
  category: "Productivity",
  source: {
    type: "discovery",
    registry: "integrations.sh",
    domain: "granola.ai",
  },
  catalogId: "integrations-sh",
};

const github: RemotePluginCatalogEntry = {
  id: "github",
  name: "GitHub",
  description: "Repositories and pull requests.",
  category: "Engineering",
  source: { type: "bundled", path: "/plugins/github" },
  catalogId: "chief-bundled",
  domains: ["github.com"],
};

void test("classifies in-browser MCP OAuth when a HTTPS surface is reachable", () => {
  const result = classifyPluginAuthorization({
    plugin: granola,
    surfaceStatus: 200,
    surfaceDocument: {
      surfaces: [
        {
          type: "mcp",
          url: "https://mcp.granola.ai/mcp",
          transports: ["streamable-http"],
        },
      ],
    },
    endpointStatus: 401,
    oauthMetadata: {
      registration_endpoint: "https://mcp.granola.ai/register",
      authorization_endpoint: "https://mcp.granola.ai/authorize",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.flow, "mcp_oauth");
  assert.equal(result.mcpUrl, "https://mcp.granola.ai/mcp");
  assert.equal(result.surfaceUrl, integrationsSurfaceUrl("granola.ai"));
});

void test("classifies GitHub-style providers as configured OAuth clients", () => {
  const result = classifyPluginAuthorization({
    plugin: github,
    endpointStatus: 401,
    oauthMetadata: {
      authorization_endpoint: "https://github.com/login/oauth/authorize",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.flow, "oauth_client");
  assert.equal(result.mcpUrl, "https://api.githubcopilot.com/mcp/");
});

void test("marks missing or dead MCP surfaces as broken", () => {
  assert.equal(
    classifyPluginAuthorization({
      plugin: granola,
      surfaceStatus: 404,
    }).ok,
    false,
  );
  assert.equal(
    classifyPluginAuthorization({
      plugin: granola,
      surfaceStatus: 200,
      surfaceDocument: {
        surfaces: [
          { type: "openapi", url: "https://api.example/openapi.json" },
        ],
      },
    }).flow,
    "broken",
  );
  assert.equal(
    classifyPluginAuthorization({
      plugin: granola,
      surfaceStatus: 200,
      surfaceDocument: {
        surfaces: [{ type: "mcp", url: "https://mcp.example.com/mcp" }],
      },
      endpointStatus: 404,
    }).ok,
    false,
  );
  assert.match(
    classifyPluginAuthorization({
      plugin: granola,
      surfaceStatus: 200,
      surfaceDocument: {
        surfaces: [{ type: "mcp", url: "hookdeck gateway mcp" }],
      },
    }).reason,
    /invalid/i,
  );
});

void test("walks every catalog plugin through surface and authorization URLs", async () => {
  const documents = new Map<string, { status: number; json?: unknown }>([
    [
      "https://integrations.sh/api.json",
      {
        status: 200,
        json: {
          data: [
            {
              kind: "mcp",
              slug: "granola",
              name: "Granola",
              domain: "granola.ai",
              description: "Meeting notes.",
            },
            {
              kind: "mcp",
              slug: "needle",
              name: "Needle",
              domain: "noodleseed.com",
              description: "Find customers.",
            },
            {
              kind: "mcp",
              slug: "lunarcrush",
              name: "LunarCrush",
              domain: "lunarcrush.com",
              description: "Social analytics.",
            },
            {
              kind: "mcp",
              slug: "missing-surface",
              name: "Missing Surface",
              domain: "missing.example",
              description: "Gone.",
            },
            {
              kind: "mcp",
              slug: "broken-url",
              name: "Broken URL",
              domain: "broken-url.example",
              description: "Bad endpoint.",
            },
          ],
        },
      },
    ],
    [
      integrationsSurfaceUrl("granola.ai"),
      {
        status: 200,
        json: {
          surfaces: [{ type: "mcp", url: "https://mcp.granola.ai/mcp" }],
        },
      },
    ],
    ["https://mcp.granola.ai/mcp", { status: 401 }],
    [
      requiredCatalogUrl(
        oauthProtectedResourceUrl("https://mcp.granola.ai/mcp"),
      ),
      {
        status: 200,
        json: {
          registration_endpoint: "https://mcp.granola.ai/register",
          authorization_endpoint: "https://mcp.granola.ai/authorize",
        },
      },
    ],
    [
      integrationsSurfaceUrl("noodleseed.com"),
      {
        status: 200,
        json: {
          surfaces: [{ type: "mcp", url: "https://mcp.noodleseed.com/" }],
        },
      },
    ],
    ["https://mcp.noodleseed.com/", { status: 401 }],
    [
      requiredCatalogUrl(
        oauthProtectedResourceUrl("https://mcp.noodleseed.com/"),
      ),
      { status: 404 },
    ],
    [
      requiredCatalogUrl(
        oauthAuthorizationServerUrl("https://mcp.noodleseed.com/"),
      ),
      { status: 404 },
    ],
    [
      integrationsSurfaceUrl("lunarcrush.com"),
      {
        status: 200,
        json: {
          surfaces: [{ type: "mcp", url: "https://mcp.lunarcrush.com/mcp" }],
        },
      },
    ],
    ["https://mcp.lunarcrush.com/mcp", { status: 200 }],
    [
      requiredCatalogUrl(
        oauthProtectedResourceUrl("https://mcp.lunarcrush.com/mcp"),
      ),
      { status: 404 },
    ],
    [
      requiredCatalogUrl(
        oauthAuthorizationServerUrl("https://mcp.lunarcrush.com/mcp"),
      ),
      { status: 404 },
    ],
    [integrationsSurfaceUrl("missing.example"), { status: 404 }],
    [
      integrationsSurfaceUrl("broken-url.example"),
      {
        status: 200,
        json: {
          surfaces: [{ type: "mcp", url: "hookdeck gateway mcp" }],
        },
      },
    ],
    ["https://api.githubcopilot.com/mcp/", { status: 401 }],
    [
      requiredCatalogUrl(
        oauthProtectedResourceUrl("https://api.githubcopilot.com/mcp/"),
      ),
      {
        status: 200,
        json: {
          authorization_endpoint: "https://github.com/login/oauth/authorize",
        },
      },
    ],
  ]);

  const requested: string[] = [];
  const summary = await auditPluginCatalog({
    extraPlugins: [github],
    fetchDocument: (url) => {
      requested.push(url);
      const document = documents.get(url);
      if (!document) return Promise.resolve({ status: 404, url, headers: {} });
      return Promise.resolve({
        status: document.status,
        url,
        headers: {},
        json: document.json,
      });
    },
  });

  assert.equal(summary.total, 6);
  assert.equal(summary.ok, 4);
  assert.equal(summary.broken, 2);
  assert.equal(summary.mcpOAuth, 3);
  assert.equal(summary.oauthClient, 1);
  assert.deepEqual(
    summary.results.map((result) => [result.pluginId, result.flow, result.ok]),
    [
      ["broken-url", "broken", false],
      ["github", "oauth_client", true],
      ["granola", "mcp_oauth", true],
      ["lunarcrush", "mcp_oauth", true],
      ["missing-surface", "broken", false],
      ["needle", "mcp_oauth", true],
    ],
  );
  assert.ok(requested.includes(integrationsSurfaceUrl("noodleseed.com")));
  assert.ok(requested.includes("https://mcp.granola.ai/mcp"));
  assert.ok(requested.includes("https://api.githubcopilot.com/mcp/"));
});
