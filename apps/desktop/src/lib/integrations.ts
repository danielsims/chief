import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { z } from "zod";

export interface IntegrationSearchResult {
  domain: string;
  name: string;
  description: string;
  kinds: string[];
  url: string;
}

const integrationSearchResultSchema = z.object({
  domain: z.string(),
  name: z.string(),
  description: z.string(),
  kinds: z.array(z.string()),
  url: z.string(),
});
const integrationSearchResponseSchema = z.object({
  results: z.array(integrationSearchResultSchema).optional(),
});

const integrationSearches = new Map<
  string,
  Promise<IntegrationSearchResult[]>
>();
const resolvedIntegrationSearches = new Map<
  string,
  IntegrationSearchResult[]
>();

export function integrationLogoUrl(domain: string) {
  return `https://integrations.sh/logo/${domain}`;
}

export async function searchIntegrations(query: string) {
  const key = query.trim().toLowerCase();
  const cached = resolvedIntegrationSearches.get(key);
  if (cached) return cached;
  const pending = integrationSearches.get(key);
  if (pending) return pending;

  const request = (async () => {
    const fetcher = isTauri() ? tauriFetch : fetch;
    const response = await fetcher(
      `https://integrations.sh/api/search?q=${encodeURIComponent(key)}`,
    );
    if (!response.ok) {
      throw new Error(`integrations.sh search failed: ${response.status}`);
    }

    const data = integrationSearchResponseSchema.parse(await response.json());
    const results = data.results ?? [];
    resolvedIntegrationSearches.set(key, results);
    return results;
  })().finally(() => integrationSearches.delete(key));
  integrationSearches.set(key, request);
  return request;
}

export function cachedIntegrationSearch(query: string) {
  return resolvedIntegrationSearches.get(query.trim().toLowerCase());
}
