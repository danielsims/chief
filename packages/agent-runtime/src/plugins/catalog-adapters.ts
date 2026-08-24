import { fileURLToPath } from "node:url";

import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
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

function text(value: unknown) {
  return isJsonString(value) && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => isJsonString(item))
    : [];
}

function displayName(id: string) {
  return id
    .split(/[.-]/g)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function parseAgentCatalog(
  catalogId: string,
  raw: unknown,
): RemotePluginCatalogEntry[] {
  if (
    !raw ||
    !isJsonObject(raw) ||
    !Array.isArray((raw as { plugins?: unknown }).plugins)
  ) {
    throw new Error("Catalog document does not contain a plugins list.");
  }
  return (raw as { plugins: unknown[] }).plugins.flatMap((candidate) => {
    if (!candidate || !isJsonObject(candidate) || Array.isArray(candidate))
      return [];
    const item = candidate as Record<string, unknown>;
    const id = text(item.name);
    const description = text(item.description);
    const source = item.source;
    if (
      !id ||
      !description ||
      !source ||
      !isJsonObject(source) ||
      Array.isArray(source)
    )
      return [];
    const sourceItem = source as Record<string, unknown>;
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
  raw: unknown,
): RemotePluginCatalogEntry[] {
  if (
    !raw ||
    !isJsonObject(raw) ||
    !Array.isArray((raw as { data?: unknown }).data)
  ) {
    throw new Error("integrations.sh did not return its catalog envelope.");
  }
  return (raw as { data: unknown[] }).data.flatMap((candidate) => {
    if (!candidate || !isJsonObject(candidate) || Array.isArray(candidate))
      return [];
    const item = candidate as Record<string, unknown>;
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
  discovery: 0,
  bundled: 1,
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
          const document = (await response.json()) as unknown;
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
  const entries = [bundledGoogleWorkspace, ...remoteEntries];
  const next = {
    entries: mergePluginCatalogEntries(entries),
    refreshedAt: Date.now(),
    ...(warnings.length ? { warning: warnings.join("; ") } : undefined),
  };
  catalogCache.set(workspaceId, next);
  return next;
}
