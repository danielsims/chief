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
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { AgentPluginSummary } from "@chief/plugin-api";

import type {
  PluginCatalogSnapshot,
  RemotePluginCatalogEntry,
} from "./types.js";
import { fetchPluginCatalog } from "./catalog-adapters.js";
import { loadAgentPlugin } from "./loader.js";
import {
  copyPluginPackage,
  readPluginState,
  savePluginInstallation,
} from "./store.js";

const execFileAsync = promisify(execFile);
const PLUGIN_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

async function installedSummary(
  entry: RemotePluginCatalogEntry,
  installation:
    | Awaited<ReturnType<typeof readPluginState>>["installations"][string]
    | undefined,
) {
  let diagnostics: string[] | undefined;
  let hasRemoteServer = false;
  let loadFailed = false;
  if (installation) {
    try {
      const loaded = await loadAgentPlugin(installation.packageRoot);
      diagnostics = loaded.diagnostics;
      hasRemoteServer = loaded.mcpServers.some(
        ({ spec }) => spec.type === "streamable-http" || spec.type === "sse",
      );
    } catch (error) {
      loadFailed = true;
      diagnostics = [error instanceof Error ? error.message : String(error)];
    }
  }
  return {
    ...entry,
    status: loadFailed
      ? ("error" as const)
      : !installation
        ? ("available" as const)
        : hasRemoteServer
          ? ("authorization_required" as const)
          : ("installed" as const),
    enabled: installation?.enabled ?? false,
    trusted: installation?.trusted ?? false,
    installedAt: installation?.installedAt,
    diagnostics,
  } satisfies AgentPluginSummary;
}

export async function pluginCatalog(
  workspaceId: string,
  force = false,
): Promise<PluginCatalogSnapshot> {
  const [catalog, state] = await Promise.all([
    fetchPluginCatalog(workspaceId, force),
    readPluginState(workspaceId),
  ]);
  return {
    plugins: await Promise.all(
      catalog.entries.map((entry) =>
        installedSummary(entry, state.installations[entry.id]),
      ),
    ),
    sources: state.catalogSources,
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
    const description =
      typeof legacy.description === "string" ? legacy.description : undefined;
    await writeFile(
      manifestPath,
      `${JSON.stringify({ $schema: PLUGIN_SCHEMA, name: fallbackName, description }, null, 2)}\n`,
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
      `${JSON.stringify({ $schema: MCP_SCHEMA, mcpServers: servers }, null, 2)}\n`,
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
    `https://integrations.sh/api/${encodeURIComponent(entry.source.domain)}/surface`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    },
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
  if (!surface?.url)
    throw new Error(
      `${entry.name} does not publish a connectable MCP endpoint.`,
    );
  const endpoint = new URL(surface.url);
  if (endpoint.protocol !== "https:")
    throw new Error(
      `${entry.name}'s discovered MCP endpoint does not use HTTPS.`,
    );
  await mkdir(root, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(
      join(root, "plugin.json"),
      `${JSON.stringify(
        {
          $schema: PLUGIN_SCHEMA,
          name: entry.id,
          description: entry.description,
          homepage: entry.homepage,
          keywords: entry.keywords,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      join(root, "mcp.json"),
      `${JSON.stringify(
        {
          $schema: MCP_SCHEMA,
          mcpServers: {
            [entry.id]: { type: "streamable-http", url: endpoint.toString() },
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ),
  ]);
}

async function clonePinnedPackage(
  temporary: string,
  entry: RemotePluginCatalogEntry & {
    source: { type: "git"; url: string; sha: string; path?: string };
  },
) {
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(
      entry.source.url,
    )
  ) {
    throw new Error("Only pinned HTTPS GitHub plugin sources are supported.");
  }
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
  const actualSha = (
    await execFileAsync("git", ["-C", temporary, "rev-parse", "HEAD"])
  ).stdout.trim();
  if (actualSha !== entry.source.sha)
    throw new Error("Fetched plugin does not match its pinned commit.");
  const sourceRoot = entry.source.path
    ? resolve(temporary, entry.source.path)
    : temporary;
  if (relative(temporary, sourceRoot).startsWith(".."))
    throw new Error("Plugin package path escapes its repository.");
  return sourceRoot;
}

export async function installCatalogPlugin(
  workspaceId: string,
  pluginId: string,
  trusted = false,
) {
  if (
    !/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/.test(pluginId)
  ) {
    throw new Error("Plugin ID is invalid.");
  }
  const catalog = await fetchPluginCatalog(workspaceId);
  const entry = catalog.entries.find((item) => item.id === pluginId);
  if (!entry)
    throw new Error(`Plugin ${pluginId} is not in an enabled catalog.`);
  const temporary = await mkdtemp(join(tmpdir(), "chief-plugin-"));
  try {
    let sourceRoot: string;
    if (entry.source.type === "discovery") {
      await materializeDiscoveredPackage(
        temporary,
        entry as typeof entry & {
          source: { type: "discovery"; registry: string; domain: string };
        },
      );
      sourceRoot = temporary;
    } else if (entry.source.type === "git") {
      sourceRoot = await clonePinnedPackage(
        temporary,
        entry as typeof entry & {
          source: { type: "git"; url: string; sha: string; path?: string };
        },
      );
    } else {
      sourceRoot = entry.source.path;
    }
    if (entry.source.type === "git") {
      await normalizeLegacyPackage(sourceRoot, pluginId);
    }
    // Validate the staged package before replacing a working installation.
    await loadAgentPlugin(sourceRoot);
    const packageRoot = await copyPluginPackage(
      workspaceId,
      pluginId,
      sourceRoot,
    );
    const loaded = await loadAgentPlugin(packageRoot);
    await savePluginInstallation(workspaceId, {
      id: pluginId,
      packageRoot,
      sourceSha: entry.source.type === "git" ? entry.source.sha : undefined,
      enabled: true,
      trusted,
      installedAt: Date.now(),
    });
    return { entry, loaded };
  } finally {
    await rm(temporary, { recursive: true, force: true });
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
