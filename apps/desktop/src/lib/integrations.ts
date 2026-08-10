import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export interface IntegrationSearchResult {
  domain: string;
  name: string;
  description: string;
  kinds: string[];
  url: string;
}

interface IntegrationSearchResponse {
  results?: IntegrationSearchResult[];
}

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

    const data = (await response.json()) as IntegrationSearchResponse;
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
