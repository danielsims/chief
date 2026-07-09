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

export function integrationLogoUrl(domain: string) {
  return `https://integrations.sh/logo/${domain}`;
}

export async function searchIntegrations(query: string) {
  const fetcher = isTauri() ? tauriFetch : fetch;
  const response = await fetcher(
    `https://integrations.sh/api/search?q=${encodeURIComponent(query)}`,
  );
  if (!response.ok) {
    throw new Error(`integrations.sh search failed: ${response.status}`);
  }

  const data = (await response.json()) as IntegrationSearchResponse;
  return data.results ?? [];
}
