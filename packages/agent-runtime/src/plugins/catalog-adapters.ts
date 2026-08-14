import type { RemotePluginCatalogEntry } from "./types.js";
import { readPluginState } from "./store.js";

const CATALOG_TTL_MS = 15 * 60_000;
const PLUGIN_ID = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const catalogCache = new Map<
  string,
  { entries: RemotePluginCatalogEntry[]; refreshedAt: number; warning?: string }
>();

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
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
    typeof raw !== "object" ||
    !Array.isArray((raw as { plugins?: unknown }).plugins)
  ) {
    throw new Error("Catalog document does not contain a plugins list.");
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
    if (!id || !PLUGIN_ID.test(id) || !name || !description || !domain)
      return [];
    const categories = strings(item.categories);
    const popularity =
      typeof item.popularity === "number" ? item.popularity : 0;
    return [
      {
        id,
        name,
        description,
        category: categories[0] ?? "Other",
        homepage: text(item.url) ?? `https://integrations.sh/${domain}/`,
        iconUrl: text(item.icon) ?? `https://integrations.sh/logo/${domain}`,
        featured: popularity > 10_000,
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
            entries: [] as RemotePluginCatalogEntry[],
            warning: `${source.name}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }),
  );
  const entries = results.flatMap((result) => result.entries);
  const warnings = results.flatMap((result) =>
    result.warning ? [result.warning] : [],
  );
  if (entries.length === 0 && cached) {
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
