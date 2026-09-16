import { fileURLToPath } from "node:url";

import type { JsonValue } from "@chief/relay-contracts";
import {
  isJsonNumber,
  isJsonString,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

import type { RemotePluginCatalogEntry } from "./types.js";
import { readPluginState } from "./store.js";

const CATALOG_TTL_MS = 15 * 60_000;
const PLUGIN_ID = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const INTEGRATIONS_DISPLAY_NAMES: Record<string, string> = {
  "gmail.googleapis.com": "Gmail",
};
const catalogCache = new Map<
  string,
  { entries: RemotePluginCatalogEntry[]; refreshedAt: number; warning?: string }
>();

const bundledGoogleWorkspace: RemotePluginCatalogEntry = {
  id: "google-workspace",
  name: "Google Workspace",
  description:
    "Connect Gmail and Google Drive through Google's remote MCP services.",
  category: "Communication",
  homepage: "https://workspace.google.com/",
  featured: true,
  popularity: 100_000,
  source: {
    type: "bundled",
    path: fileURLToPath(
      new URL("../plugins-bundled/google-workspace/", import.meta.url),
    ),
  },
  catalogId: "chief-bundled",
  domains: [
    "workspace.google.com",
    "gmail.googleapis.com",
    "file.googleapis.com",
  ],
  keywords: ["Google Workspace", "Gmail", "Google Drive", "email", "files"],
};

const bundledGitHub: RemotePluginCatalogEntry = {
  id: "github",
  name: "GitHub",
  description:
    "Work with repositories, issues, pull requests, and code on GitHub.",
  category: "Engineering",
  homepage: "https://github.com/",
  repository: "https://github.com/github/github-mcp-server",
  featured: true,
  popularity: 100_000,
  source: {
    type: "bundled",
    path: fileURLToPath(new URL("../plugins-bundled/github/", import.meta.url)),
  },
  catalogId: "chief-bundled",
  domains: ["github.com"],
  keywords: ["GitHub", "Git", "repositories", "issues", "pull requests"],
};

function text(value: JsonValue | undefined) {
  return isJsonString(value) && value.trim() ? value.trim() : undefined;
}

function strings(value: JsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => isJsonString(item))
    : [];
}

export function parseMcpSurfaceFromDocument(
  raw: unknown,
): { url: string; name?: string } | undefined {
  const document = parseJsonObject(raw);
  const surfaces = Array.isArray(document?.surfaces) ? document.surfaces : [];
  const surface = surfaces.flatMap((candidate) => {
    const item = parseJsonObject(candidate);
    return item?.type === "mcp" && isJsonString(item.url) ? [item] : [];
  })[0];
  if (!surface || !isJsonString(surface.url)) return undefined;
  return {
    url: surface.url,
    ...(isJsonString(surface.name) ? { name: surface.name } : undefined),
  };
}

function displayName(id: string) {
  return id
    .split(/[.-]/g)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function parseAgentCatalog(
  catalogId: string,
  raw: JsonValue,
): RemotePluginCatalogEntry[] {
  const document = parseJsonObject(raw);
  if (!document || !Array.isArray(document.plugins)) {
    throw new Error("Catalog document does not contain a plugins list.");
  }
  return document.plugins.flatMap((candidate) => {
    const item = parseJsonObject(candidate);
    if (!item) return [];
    const id = text(item.name);
    const description = text(item.description);
    const source = item.source;
    const sourceItem = parseJsonObject(source);
    if (!id || !description || !sourceItem) return [];
    const url = text(sourceItem.url);
    const sha = text(sourceItem.sha);
    if (!PLUGIN_ID.test(id) || !url || !sha || !/^[a-f0-9]{40}$/i.test(sha))
      return [];
    return [
      {
        id,
        name: displayName(id),
        description,
        category: text(item.category) ?? "Other",
        homepage: text(item.homepage),
        repository: url,
        source: {
          type: "git" as const,
          url,
          sha,
          path: text(sourceItem.path),
        },
        catalogId,
        domains: strings(item.domains),
        keywords: strings(item.keywords),
      },
    ];
  });
}

export function parseIntegrationsCatalog(
  raw: JsonValue,
): RemotePluginCatalogEntry[] {
  const document = parseJsonObject(raw);
  if (!document || !Array.isArray(document.data)) {
    throw new Error("integrations.sh did not return its catalog envelope.");
  }
  return document.data.flatMap((candidate) => {
    const item = parseJsonObject(candidate);
    if (!item) return [];
    if (item.kind !== "mcp") return [];
    const id = text(item.slug);
    const name = text(item.name);
    const description = text(item.description);
    const domain = text(item.domain);
    if (!id || !PLUGIN_ID.test(id) || !name || !description || !domain)
      return [];
    const categories = strings(item.categories);
    const popularity = isJsonNumber(item.popularity) ? item.popularity : 0;
    return [
      {
        id,
        name: INTEGRATIONS_DISPLAY_NAMES[domain] ?? name,
        description,
        category: categories[0] ?? "Other",
        homepage: text(item.url) ?? `https://integrations.sh/${domain}/`,
        iconUrl: text(item.icon) ?? `https://integrations.sh/logo/${domain}`,
        featured: popularity > 10_000,
        popularity,
        source: {
          type: "discovery" as const,
          registry: "integrations.sh",
          domain,
        },
        catalogId: "integrations-sh",
        domains: [domain],
        keywords: [name, id, ...categories],
      },
    ];
  });
}

const sourcePriority: Record<
  RemotePluginCatalogEntry["source"]["type"],
  number
> = {
  bundled: 0,
  discovery: 1,
  git: 2,
};

export function mergePluginCatalogEntries(
  entries: readonly RemotePluginCatalogEntry[],
) {
  const merged = new Map<string, RemotePluginCatalogEntry>();
  for (const entry of entries) {
    const current = merged.get(entry.id);
    if (
      !current ||
      sourcePriority[entry.source.type] < sourcePriority[current.source.type]
    ) {
      merged.set(entry.id, entry);
    }
  }
  return [...merged.values()];
}

export async function fetchPluginCatalog(workspaceId: string, force = false) {
  const cached = catalogCache.get(workspaceId);
  if (!force && cached && Date.now() - cached.refreshedAt < CATALOG_TTL_MS)
    return cached;
  const state = await readPluginState(workspaceId);
  const results = await Promise.all(
    state.catalogSources
      .filter((source) => source.enabled)
      .map(async (source) => {
        try {
          const response = await fetch(source.catalogUrl, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(12_000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const raw: unknown = await response.json();
          const document = parseJsonValue(raw);
          if (document === undefined) {
            throw new Error("Catalog response was not valid JSON.");
          }
          return {
            entries:
              source.format === "integrations-sh"
                ? parseIntegrationsCatalog(document)
                : parseAgentCatalog(source.id, document),
          };
        } catch (error) {
          return {
            entries: [] satisfies RemotePluginCatalogEntry[],
            warning: `${source.name}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }),
  );
  const remoteEntries = results.flatMap((result) => result.entries);
  const warnings = results.flatMap((result) =>
    result.warning ? [result.warning] : [],
  );
  if (remoteEntries.length === 0 && cached) {
    return { ...cached, warning: warnings.join("; ") };
  }
  const entries = [bundledGoogleWorkspace, bundledGitHub, ...remoteEntries];
  const next = {
    entries: mergePluginCatalogEntries(entries),
    refreshedAt: Date.now(),
    ...(warnings.length ? { warning: warnings.join("; ") } : undefined),
  };
  catalogCache.set(workspaceId, next);
  return next;
}
