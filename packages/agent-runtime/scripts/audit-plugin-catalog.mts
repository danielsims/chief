import type { PluginCatalogHealthSummary } from "../src/plugins/catalog-health.js";
import type { RemotePluginCatalogEntry } from "../src/plugins/types.js";
import {
  auditPluginCatalog,
  fetchPluginCatalogHealthDocument,
} from "../src/plugins/catalog-health.js";

/**
 * Probes every integrations.sh MCP plugin (plus Chief's bundled GitHub and
 * Google Workspace connectors) by fetching its surface catalog and hitting the
 * discovered MCP / OAuth URLs. This is a live health check, not a unit test.
 *
 *   pnpm --filter @chief/agent-runtime audit:plugin-catalog
 */

const bundled: RemotePluginCatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    description:
      "Work with repositories, issues, pull requests, and code on GitHub.",
    category: "Engineering",
    source: { type: "bundled", path: "plugins-bundled/github" },
    catalogId: "chief-bundled",
    domains: ["github.com"],
  },
  {
    id: "google-workspace",
    name: "Google Workspace",
    description:
      "Connect Gmail and Google Drive through Google's remote MCP services.",
    category: "Communication",
    source: { type: "bundled", path: "plugins-bundled/google-workspace" },
    catalogId: "chief-bundled",
    domains: ["workspace.google.com"],
  },
];

function line(
  result: PluginCatalogHealthSummary["results"][number],
  kind: "ok" | "broken",
) {
  const flow =
    result.flow === "mcp_oauth"
      ? "mcp-oauth"
      : result.flow === "oauth_client"
        ? "oauth-client"
        : "broken";
  const target = result.mcpUrl ?? result.surfaceUrl ?? "";
  return `${kind === "ok" ? "ok" : "fail"}\t${flow}\t${result.pluginId}\t${result.name}\t${target}\t${result.reason}`;
}

const summary = await auditPluginCatalog({
  extraPlugins: bundled,
  fetchDocument: fetchPluginCatalogHealthDocument,
  concurrency: 16,
  onProgress: (done, total) => {
    if (done === total || done % 25 === 0) {
      process.stderr.write(`probed ${done}/${total}\n`);
    }
  },
});

const broken = summary.results.filter((result) => !result.ok);
const working = summary.results.filter((result) => result.ok);

process.stdout.write(
  [
    `checked ${summary.total} plugins`,
    `${summary.ok} reachable`,
    `${summary.broken} broken`,
    `${summary.mcpOAuth} mcp-oauth`,
    `${summary.oauthClient} oauth-client`,
    "",
    ...working.map((result) => line(result, "ok")),
    ...broken.map((result) => line(result, "broken")),
    "",
  ].join("\n"),
);

if (broken.length > 0) {
  process.exitCode = 1;
}
