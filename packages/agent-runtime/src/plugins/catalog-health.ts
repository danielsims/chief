import {
  isJsonObject,
  isJsonString,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

import type { RemotePluginCatalogEntry } from "./types.js";
import {
  parseIntegrationsCatalog,
  parseMcpSurfaceFromDocument,
} from "./catalog-adapters.js";

export const INTEGRATIONS_CATALOG_URL = "https://integrations.sh/api.json";

export type PluginAuthFlow = "mcp_oauth" | "oauth_client" | "broken";

export interface PluginCatalogHealthResult {
  pluginId: string;
  name: string;
  domain?: string;
  flow: PluginAuthFlow;
  ok: boolean;
  reason: string;
  surfaceUrl?: string;
  mcpUrl?: string;
  authorizationUrl?: string;
  httpStatus?: number;
}

export interface PluginCatalogHealthSummary {
  checkedAt: string;
  total: number;
  ok: number;
  broken: number;
  mcpOAuth: number;
  oauthClient: number;
  results: PluginCatalogHealthResult[];
}

export interface PluginCatalogHealthFetchResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  json?: unknown;
}

export type PluginCatalogHealthFetch = (
  url: string,
) => Promise<PluginCatalogHealthFetchResponse>;

const BUNDLED_MCP_ENDPOINTS: Record<string, string[]> = {
  github: ["https://api.githubcopilot.com/mcp/"],
  "google-workspace": [
    "https://gmail.googleapis.com/mcp/",
    "https://file.googleapis.com/mcp",
  ],
};

const REACHABLE_STATUSES = new Set([
  200, 204, 301, 302, 303, 307, 308, 400, 401, 403, 405, 406, 415, 422,
]);

export function integrationsSurfaceUrl(domain: string) {
  return `https://integrations.sh/api/${encodeURIComponent(domain)}/surface`;
}

export function oauthProtectedResourceUrl(mcpUrl: string) {
  try {
    const endpoint = new URL(mcpUrl);
    if (endpoint.protocol !== "https:") return undefined;
    const path = endpoint.pathname.endsWith("/")
      ? endpoint.pathname
      : `${endpoint.pathname}/`;
    return new URL(
      `${path}.well-known/oauth-protected-resource`,
      endpoint.origin,
    ).toString();
  } catch {
    return undefined;
  }
}

export function oauthAuthorizationServerUrl(mcpUrl: string) {
  try {
    const endpoint = new URL(mcpUrl);
    if (endpoint.protocol !== "https:") return undefined;
    return new URL(
      "/.well-known/oauth-authorization-server",
      endpoint.origin,
    ).toString();
  } catch {
    return undefined;
  }
}

export function classifyPluginAuthorization({
  plugin,
  surfaceStatus,
  surfaceDocument,
  endpointStatus,
  oauthMetadata,
}: {
  plugin: Pick<RemotePluginCatalogEntry, "id" | "name" | "source" | "domains">;
  surfaceStatus?: number;
  surfaceDocument?: unknown;
  endpointStatus?: number;
  oauthMetadata?: unknown;
}): PluginCatalogHealthResult {
  const domain =
    plugin.source.type === "discovery"
      ? plugin.source.domain
      : plugin.domains?.[0];
  const surfaceUrl =
    plugin.source.type === "discovery"
      ? integrationsSurfaceUrl(plugin.source.domain)
      : undefined;
  const bundledEndpoints = BUNDLED_MCP_ENDPOINTS[plugin.id];

  if (plugin.source.type === "bundled" && bundledEndpoints) {
    const mcpUrl = bundledEndpoints[0];
    const flow = hasDynamicClientRegistration(oauthMetadata)
      ? "mcp_oauth"
      : "oauth_client";
    const reachable =
      endpointStatus === undefined || isReachableStatus(endpointStatus);
    return {
      pluginId: plugin.id,
      name: plugin.name,
      domain,
      flow,
      ok: reachable,
      reason: reachable
        ? flow === "oauth_client"
          ? "Provider requires a configured OAuth client before browser authorization."
          : "Remote MCP endpoint is reachable and supports OAuth."
        : `Bundled MCP endpoint returned HTTP ${endpointStatus}.`,
      mcpUrl,
      httpStatus: endpointStatus,
    };
  }

  if (surfaceStatus !== undefined && surfaceStatus >= 400) {
    return {
      pluginId: plugin.id,
      name: plugin.name,
      domain,
      flow: "broken",
      ok: false,
      reason: `Surface catalog returned HTTP ${surfaceStatus}.`,
      surfaceUrl,
      httpStatus: surfaceStatus,
    };
  }

  const surface = parseMcpSurfaceFromDocument(surfaceDocument);
  if (!surface) {
    return {
      pluginId: plugin.id,
      name: plugin.name,
      domain,
      flow: "broken",
      ok: false,
      reason: "Catalog entry does not publish a connectable MCP surface.",
      surfaceUrl,
      httpStatus: surfaceStatus,
    };
  }

  let mcpUrl: string;
  try {
    const endpoint = new URL(surface.url);
    if (endpoint.protocol !== "https:") {
      return {
        pluginId: plugin.id,
        name: plugin.name,
        domain,
        flow: "broken",
        ok: false,
        reason: "Discovered MCP endpoint does not use HTTPS.",
        surfaceUrl,
        mcpUrl: surface.url,
        httpStatus: surfaceStatus,
      };
    }
    mcpUrl = endpoint.toString();
  } catch {
    return {
      pluginId: plugin.id,
      name: plugin.name,
      domain,
      flow: "broken",
      ok: false,
      reason: "Discovered MCP endpoint URL is invalid.",
      surfaceUrl,
      mcpUrl: surface.url,
      httpStatus: surfaceStatus,
    };
  }

  if (endpointStatus !== undefined && !isReachableStatus(endpointStatus)) {
    return {
      pluginId: plugin.id,
      name: plugin.name,
      domain,
      flow: "broken",
      ok: false,
      reason: `MCP endpoint returned HTTP ${endpointStatus}.`,
      surfaceUrl,
      mcpUrl,
      httpStatus: endpointStatus,
    };
  }

  const flow = hasDynamicClientRegistration(oauthMetadata)
    ? "mcp_oauth"
    : hasAuthorizationEndpoint(oauthMetadata)
      ? "oauth_client"
      : "mcp_oauth";
  return {
    pluginId: plugin.id,
    name: plugin.name,
    domain,
    flow,
    ok: true,
    reason:
      flow === "oauth_client"
        ? "Provider requires a configured OAuth client before browser authorization."
        : "Remote MCP endpoint is reachable for in-browser OAuth.",
    surfaceUrl,
    mcpUrl,
    authorizationUrl: parseAuthorizationEndpoint(oauthMetadata),
    httpStatus: endpointStatus,
  };
}

export async function auditPluginCatalog({
  fetchDocument,
  catalogUrl = INTEGRATIONS_CATALOG_URL,
  extraPlugins = [],
  concurrency = 16,
  onProgress,
}: {
  fetchDocument: PluginCatalogHealthFetch;
  catalogUrl?: string;
  extraPlugins?: RemotePluginCatalogEntry[];
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<PluginCatalogHealthSummary> {
  const catalog = await fetchDocument(catalogUrl);
  if (catalog.status >= 400 || catalog.json === undefined) {
    throw new Error(
      `Plugin catalog is unavailable (HTTP ${catalog.status} from ${catalogUrl}).`,
    );
  }
  const document = parseJsonValue(catalog.json);
  if (document === undefined) {
    throw new Error(`Plugin catalog from ${catalogUrl} was not valid JSON.`);
  }
  const discovered = parseIntegrationsCatalog(document);
  const plugins = mergeById([...extraPlugins, ...discovered]);
  let done = 0;
  const results = await mapPool(plugins, concurrency, async (plugin) => {
    const result = await auditOnePlugin(fetchDocument, plugin);
    done += 1;
    onProgress?.(done, plugins.length);
    return result;
  });
  results.sort((left, right) => left.name.localeCompare(right.name));
  return summarizeHealth(results);
}

async function auditOnePlugin(
  fetchDocument: PluginCatalogHealthFetch,
  plugin: RemotePluginCatalogEntry,
) {
  if (plugin.source.type === "bundled") {
    const mcpUrl = BUNDLED_MCP_ENDPOINTS[plugin.id]?.[0];
    const endpoint = mcpUrl ? await probe(fetchDocument, mcpUrl) : undefined;
    const oauthMetadata = mcpUrl
      ? await discoverOAuthMetadata(fetchDocument, mcpUrl)
      : undefined;
    return classifyPluginAuthorization({
      plugin,
      endpointStatus: endpoint?.status,
      oauthMetadata,
    });
  }
  if (plugin.source.type !== "discovery") {
    return classifyPluginAuthorization({ plugin });
  }
  const surfaceUrl = integrationsSurfaceUrl(plugin.source.domain);
  const surface = await probe(fetchDocument, surfaceUrl);
  const parsedSurface = parseMcpSurfaceFromDocument(surface.json);
  const endpoint = parsedSurface
    ? await probe(fetchDocument, parsedSurface.url)
    : undefined;
  const oauthMetadata = parsedSurface
    ? await discoverOAuthMetadata(fetchDocument, parsedSurface.url)
    : undefined;
  return classifyPluginAuthorization({
    plugin,
    surfaceStatus: surface.status,
    surfaceDocument: surface.json,
    endpointStatus: endpoint?.status,
    oauthMetadata,
  });
}

export function summarizeHealth(
  results: PluginCatalogHealthResult[],
): PluginCatalogHealthSummary {
  return {
    checkedAt: new Date().toISOString(),
    total: results.length,
    ok: results.filter((result) => result.ok).length,
    broken: results.filter((result) => !result.ok).length,
    mcpOAuth: results.filter((result) => result.flow === "mcp_oauth").length,
    oauthClient: results.filter((result) => result.flow === "oauth_client")
      .length,
    results,
  };
}

export async function fetchPluginCatalogHealthDocument(
  url: string,
): Promise<PluginCatalogHealthFetchResponse> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ChiefPluginCatalogHealth/1.0 (+https://heychief.sh)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  const headers = Object.fromEntries(response.headers.entries());
  let json: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
  } else {
    await response.arrayBuffer();
  }
  return {
    status: response.status,
    url: response.url,
    headers,
    json,
  };
}

function mergeById(plugins: RemotePluginCatalogEntry[]) {
  const merged = new Map<string, RemotePluginCatalogEntry>();
  for (const plugin of plugins) {
    if (!merged.has(plugin.id)) merged.set(plugin.id, plugin);
  }
  return [...merged.values()];
}

async function probe(
  fetchDocument: PluginCatalogHealthFetch,
  url: string,
): Promise<PluginCatalogHealthFetchResponse> {
  try {
    return await fetchDocument(url);
  } catch (error) {
    return {
      status: 0,
      url,
      headers: {},
      json: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function discoverOAuthMetadata(
  fetchDocument: PluginCatalogHealthFetch,
  mcpUrl: string,
) {
  const resourceUrl = oauthProtectedResourceUrl(mcpUrl);
  if (!resourceUrl) return undefined;
  const resource = await probe(fetchDocument, resourceUrl);
  if (isJsonObject(resource.json)) return resource.json;
  const authorizationServerUrl = oauthAuthorizationServerUrl(mcpUrl);
  if (!authorizationServerUrl) return undefined;
  const authorizationServer = await probe(
    fetchDocument,
    authorizationServerUrl,
  );
  return authorizationServer.json;
}

function hasDynamicClientRegistration(metadata: unknown) {
  const document = parseJsonObject(metadata);
  return isJsonString(document?.registration_endpoint);
}

function hasAuthorizationEndpoint(metadata: unknown) {
  return Boolean(parseAuthorizationEndpoint(metadata));
}

function parseAuthorizationEndpoint(metadata: unknown) {
  const document = parseJsonObject(metadata);
  return isJsonString(document?.authorization_endpoint)
    ? document.authorization_endpoint
    : undefined;
}

function isReachableStatus(status: number) {
  return REACHABLE_STATUSES.has(status);
}

async function mapPool<T, R>(
  items: readonly T[],
  size: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(size, items.length || 1));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await mapper(item);
      }
    }),
  );
  return results;
}
