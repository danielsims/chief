import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import type { JsonValue } from "@chief/relay-contracts";
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonObject,
} from "@chief/relay-contracts";

interface PluginCatalogSnapshot {
  plugins: AgentPluginSummary[];
  sources: {
    id: string;
    name: string;
    homepage?: string;
    enabled: boolean;
  }[];
  refreshedAt: number;
  stale: boolean;
  warning?: string;
}

let cachedPluginCatalog: PluginCatalogSnapshot | undefined;

export async function loadRelayPluginCatalog(
  force: boolean,
): Promise<PluginCatalogSnapshot> {
  if (
    !force &&
    cachedPluginCatalog &&
    Date.now() - cachedPluginCatalog.refreshedAt < 15 * 60_000
  ) {
    return cachedPluginCatalog;
  }
  try {
    const fetcher = isTauri() ? tauriFetch : globalThis.fetch;
    const response = await fetcher("https://integrations.sh/api.json", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Catalog returned HTTP ${response.status}.`);
    }
    const document = parseJsonObject(await response.json());
    const plugins = Array.isArray(document?.data)
      ? document.data.flatMap(toCatalogPlugin)
      : [];
    cachedPluginCatalog = {
      plugins,
      sources: [
        {
          id: "integrations-sh",
          name: "integrations.sh",
          homepage: "https://integrations.sh/?kind=mcp",
          enabled: true,
        },
      ],
      refreshedAt: Date.now(),
      stale: false,
    };
    return cachedPluginCatalog;
  } catch (error) {
    if (cachedPluginCatalog) {
      return {
        ...cachedPluginCatalog,
        stale: true,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}

function toCatalogPlugin(candidate: JsonValue): AgentPluginSummary[] {
  if (!isJsonObject(candidate) || Array.isArray(candidate)) {
    return [];
  }
  const item = candidate;
  if (item.kind !== "mcp") return [];
  const id = catalogText(item.slug);
  const name = catalogText(item.name);
  const description = catalogText(item.description);
  const domain = catalogText(item.domain);
  if (!id || !name || !description || !domain) return [];
  const categories = Array.isArray(item.categories)
    ? item.categories.filter((value): value is string => isJsonString(value))
    : [];
  const popularity = isJsonNumber(item.popularity) ? item.popularity : 0;
  return [
    {
      id,
      name: domain === "gmail.googleapis.com" ? "Gmail" : name,
      description,
      category: categories[0] ?? "Other",
      homepage: catalogText(item.url) ?? `https://integrations.sh/${domain}/`,
      iconUrl:
        catalogText(item.icon) ?? `https://integrations.sh/logo/${domain}`,
      featured: popularity > 10_000,
      popularity,
      source: {
        type: "discovery",
        registry: "integrations.sh",
        domain,
      },
      domains: [domain],
      keywords: [name, id, ...categories],
      status: "available",
      enabled: false,
      trusted: false,
    },
  ];
}

function catalogText(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() ? value.trim() : undefined;
}
