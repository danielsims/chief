import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { AgentPluginSummary } from "@chief/plugin-api";

import type {
  PluginMarketplaceSnapshot,
  RemotePluginCatalogEntry,
} from "./types.js";
import { loadAgentPlugin } from "./loader.js";
import {
  copyPluginPackage,
  pluginsRoot,
  readPluginState,
  savePluginInstallation,
} from "./store.js";

const execFileAsync = promisify(execFile);
const BUNDLED_POSTHOG = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../plugins/posthog",
);
const CATALOG_TTL_MS = 15 * 60_000;
const catalogCache = new Map<
  string,
  { entries: RemotePluginCatalogEntry[]; refreshedAt: number; warning?: string }
>();

const curatedEntries: RemotePluginCatalogEntry[] = [
  {
    id: "posthog",
    name: "PostHog",
    description:
      "Access PostHog analytics, feature flags, experiments, error tracking, and insights directly from Chief.",
    category: "Analytics",
    homepage: "https://posthog.com/docs/model-context-protocol",
    repository: "https://github.com/PostHog/mcp",
    featured: true,
    source: { type: "bundled", path: BUNDLED_POSTHOG },
    marketplaceId: "chief-curated",
    domains: ["posthog.com"],
    keywords: ["analytics", "feature flags", "experiments"],
  },
];

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseRemoteCatalog(
  marketplaceId: string,
  raw: unknown,
): RemotePluginCatalogEntry[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { plugins?: unknown }).plugins)
  ) {
    throw new Error("Marketplace document does not contain a plugins list.");
  }
  return (raw as { plugins: unknown[] }).plugins.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return [];
    const item = candidate as Record<string, unknown>;
    const id = text(item.name);
    const description = text(item.description);
    const source = item.source;
    if (
      !id ||
      !description ||
      !source ||
      typeof source !== "object" ||
      Array.isArray(source)
    )
      return [];
    const sourceItem = source as Record<string, unknown>;
    const url = text(sourceItem.url);
    const sha = text(sourceItem.sha);
    if (!url || !sha || !/^[a-f0-9]{40}$/i.test(sha)) return [];
    return [
      {
        id,
        name: id
          .split("-")
          .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
          .join(" "),
        description,
        category: text(item.category) ?? "Other",
        homepage: text(item.homepage),
        source: {
          type: "git" as const,
          url,
          sha,
          path: text(sourceItem.path),
        },
        marketplaceId,
        domains: Array.isArray(item.domains)
          ? item.domains.filter(
              (value): value is string => typeof value === "string",
            )
          : undefined,
        keywords: Array.isArray(item.keywords)
          ? item.keywords.filter(
              (value): value is string => typeof value === "string",
            )
          : undefined,
      },
    ];
  });
}

function parseIntegrationsCatalog(raw: unknown): RemotePluginCatalogEntry[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { data?: unknown }).data)
  ) {
    throw new Error("integrations.sh did not return its catalog envelope.");
  }
  return (raw as { data: unknown[] }).data.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return [];
    const item = candidate as Record<string, unknown>;
    if (item.kind !== "mcp") return [];
    const id = text(item.slug);
    const name = text(item.name);
    const description = text(item.description);
    const domain = text(item.domain);
    if (!id || !name || !description || !domain) return [];
    const categories = Array.isArray(item.categories)
      ? item.categories.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return [
      {
        id,
        name,
        description,
        category: categories[0] ?? "Other",
        homepage: text(item.url) ?? `https://integrations.sh/${domain}/`,
        iconUrl: text(item.icon) ?? `https://integrations.sh/logo/${domain}`,
        featured:
          typeof item.popularity === "number" && item.popularity > 10_000,
        source: {
          type: "discovery" as const,
          registry: "integrations.sh",
          domain,
        },
        marketplaceId: "integrations-sh",
        domains: [domain],
        keywords: [name, id, ...categories],
      },
    ];
  });
}

async function fetchCatalogs(workspaceId: string, force = false) {
  const cached = catalogCache.get(workspaceId);
  if (!force && cached && Date.now() - cached.refreshedAt < CATALOG_TTL_MS)
    return cached;
  const state = await readPluginState(workspaceId);
  const entries = [...curatedEntries];
  const warnings: string[] = [];
  for (const source of state.marketplaceSources.filter(
    (item) => item.enabled,
  )) {
    try {
      const response = await fetch(source.catalogUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const document = (await response.json()) as unknown;
      entries.push(
        ...(source.format === "integrations-sh"
          ? parseIntegrationsCatalog(document)
          : parseRemoteCatalog(source.id, document)),
      );
    } catch (error) {
      warnings.push(
        `${source.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (entries.length === curatedEntries.length && cached) {
    return { ...cached, warning: warnings.join("; ") };
  }
  const next = {
    entries: [...new Map(entries.map((entry) => [entry.id, entry])).values()],
    refreshedAt: Date.now(),
    ...(warnings.length ? { warning: warnings.join("; ") } : {}),
  };
  catalogCache.set(workspaceId, next);
  return next;
}

export async function pluginMarketplace(
  workspaceId: string,
  force = false,
): Promise<PluginMarketplaceSnapshot> {
  const [catalog, state] = await Promise.all([
    fetchCatalogs(workspaceId, force),
    readPluginState(workspaceId),
  ]);
  const plugins: AgentPluginSummary[] = await Promise.all(
    catalog.entries.map(async (entry) => {
      const installation = state.installations[entry.id];
      let diagnostics: string[] | undefined;
      let hasRemoteServer = false;
      if (installation) {
        try {
          const loaded = await loadAgentPlugin(installation.packageRoot);
          diagnostics = loaded.diagnostics;
          hasRemoteServer = loaded.mcpServers.some(
            ({ spec }) =>
              spec.type === "streamable-http" || spec.type === "sse",
          );
        } catch (error) {
          diagnostics = [
            error instanceof Error ? error.message : String(error),
          ];
        }
      }
      return {
        ...entry,
        source: entry.source,
        status: diagnostics?.length
          ? "error"
          : !installation
            ? "available"
            : hasRemoteServer
              ? "authorization_required"
              : "installed",
        enabled: installation?.enabled ?? false,
        trusted: installation?.trusted ?? false,
        installedAt: installation?.installedAt,
        diagnostics,
      };
    }),
  );
  return {
    plugins,
    sources: state.marketplaceSources,
    refreshedAt: catalog.refreshedAt,
    stale: Boolean(catalog.warning),
    warning: catalog.warning,
  };
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function normalizeLegacyPackage(root: string, fallbackName: string) {
  const manifestPath = join(root, "plugin.json");
  if (!(await exists(manifestPath))) {
    const legacyPath = (
      await Promise.all(
        [".cursor-plugin/plugin.json", ".claude-plugin/plugin.json"].map(
          async (path) => ((await exists(join(root, path))) ? path : null),
        ),
      )
    ).find(Boolean);
    if (!legacyPath)
      throw new Error(
        "Package has no portable or recognized legacy plugin manifest.",
      );
    const legacy = JSON.parse(
      await readFile(join(root, legacyPath), "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          name: text(legacy.name) ?? fallbackName,
          ...(text(legacy.version) ? { version: text(legacy.version) } : {}),
          ...(text(legacy.description)
            ? { description: text(legacy.description) }
            : {}),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }
  const portableMcp = join(root, "mcp.json");
  const legacyMcp = join(root, ".mcp.json");
  if (!(await exists(portableMcp)) && (await exists(legacyMcp))) {
    const parsed = JSON.parse(await readFile(legacyMcp, "utf8")) as {
      mcpServers?: Record<string, Record<string, unknown>>;
    };
    const servers = Object.fromEntries(
      Object.entries(parsed.mcpServers ?? {}).map(([name, spec]) => [
        name,
        spec.url
          ? { ...spec, type: "streamable-http" }
          : { ...spec, type: "stdio" },
      ]),
    );
    await writeFile(
      portableMcp,
      `${JSON.stringify(
        {
          $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          mcpServers: servers,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }
}

async function materializeDiscoveredPackage(
  root: string,
  entry: RemotePluginCatalogEntry & {
    source: { type: "discovery"; registry: string; domain: string };
  },
) {
  const response = await fetch(
    `https://raw.githubusercontent.com/UsefulSoftwareCo/integrations/main/domains/${encodeURIComponent(entry.source.domain)}/integrations.json`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!response.ok)
    throw new Error(`Could not resolve ${entry.name}'s discovered endpoint.`);
  const document = (await response.json()) as {
    surfaces?: { type?: string; url?: string; name?: string }[];
  };
  const surface = document.surfaces?.find(
    (candidate) =>
      candidate.type === "mcp" && typeof candidate.url === "string",
  );
  if (!surface?.url) {
    throw new Error(
      `${entry.name} does not publish a connectable MCP endpoint.`,
    );
  }
  const endpoint = new URL(surface.url);
  if (endpoint.protocol !== "https:") {
    throw new Error(
      `${entry.name}'s discovered MCP endpoint does not use HTTPS.`,
    );
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(
    join(root, "plugin.json"),
    `${JSON.stringify(
      {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: entry.id,
        description: entry.description,
        homepage: entry.homepage,
        keywords: entry.keywords,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(root, "mcp.json"),
    `${JSON.stringify(
      {
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          [entry.id]: { type: "streamable-http", url: endpoint.toString() },
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

export async function installCatalogPlugin(
  workspaceId: string,
  pluginId: string,
  trusted = false,
) {
  const catalog = await fetchCatalogs(workspaceId);
  const entry = catalog.entries.find((item) => item.id === pluginId);
  if (!entry)
    throw new Error(`Plugin ${pluginId} is not in an enabled marketplace.`);
  let packageRoot: string;
  let temporary: string | undefined;
  try {
    if (entry.source.type === "bundled") {
      packageRoot = await copyPluginPackage(
        workspaceId,
        pluginId,
        entry.source.path,
      );
    } else if (entry.source.type === "discovery") {
      temporary = await mkdtemp(join(tmpdir(), "chief-plugin-discovery-"));
      await materializeDiscoveredPackage(
        temporary,
        entry as RemotePluginCatalogEntry & {
          source: { type: "discovery"; registry: string; domain: string };
        },
      );
      packageRoot = await copyPluginPackage(workspaceId, pluginId, temporary);
    } else {
      if (
        !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(
          entry.source.url,
        )
      ) {
        throw new Error(
          "Only HTTPS GitHub marketplace sources are supported in this preview.",
        );
      }
      temporary = await mkdtemp(join(tmpdir(), "chief-plugin-"));
      await execFileAsync("git", ["init", "--quiet", temporary]);
      await execFileAsync("git", [
        "-C",
        temporary,
        "remote",
        "add",
        "origin",
        entry.source.url,
      ]);
      await execFileAsync("git", [
        "-C",
        temporary,
        "fetch",
        "--quiet",
        "--depth=1",
        "origin",
        entry.source.sha,
      ]);
      await execFileAsync("git", [
        "-C",
        temporary,
        "checkout",
        "--quiet",
        "FETCH_HEAD",
      ]);
      const sourceRoot = entry.source.path
        ? resolve(temporary, entry.source.path)
        : temporary;
      if (!sourceRoot.startsWith(`${temporary}/`) && sourceRoot !== temporary) {
        throw new Error("Marketplace package path escapes its repository.");
      }
      packageRoot = await copyPluginPackage(workspaceId, pluginId, sourceRoot);
      await normalizeLegacyPackage(packageRoot, pluginId);
    }
    const loaded = await loadAgentPlugin(packageRoot);
    await savePluginInstallation(workspaceId, {
      id: pluginId,
      packageRoot,
      sourceSha: entry.source.type === "git" ? entry.source.sha : undefined,
      enabled: true,
      trusted,
      installedAt: Date.now(),
    });
    return { entry, installation: await readPluginState(workspaceId), loaded };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

export async function installedPlugin(workspaceId: string, pluginId: string) {
  const state = await readPluginState(workspaceId);
  const installation = state.installations[pluginId];
  if (!installation) throw new Error(`Plugin ${pluginId} is not installed.`);
  return {
    installation,
    loaded: await loadAgentPlugin(installation.packageRoot),
  };
}

export function pluginCacheDirectory(workspaceId: string) {
  return join(pluginsRoot(workspaceId), "cache", basename(workspaceId));
}
