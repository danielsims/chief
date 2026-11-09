import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

export type McpSurfaceAuth = "oauth" | "headers" | "none";

/** The key a header-auth server needs, as far as Chief can send it. */
export interface McpSurfaceApiKey {
  headerName: string;
  scheme?: "Bearer";
  /** What the provider calls it, e.g. "API key". */
  label: string;
  docsUrl?: string;
}

export interface McpSurface {
  url: string;
  name?: string;
  auth: McpSurfaceAuth;
  /** Set when `auth` is "headers" and the key goes in a plain or Bearer header. */
  apiKey?: McpSurfaceApiKey;
}

/**
 * The remote MCP endpoint an integrations.sh surface document describes, and
 * how it signs in. Shared by the local plugin host and the desktop, so it
 * must stay free of runtime-specific imports.
 */
export function parseMcpSurfaceFromDocument(
  raw: unknown,
): McpSurface | undefined {
  const document = parseJsonObject(raw);
  const surfaces = Array.isArray(document?.surfaces) ? document.surfaces : [];
  const surface = surfaces.flatMap((candidate) => {
    const item = parseJsonObject(candidate);
    return item?.type === "mcp" && isJsonString(item.url) ? [item] : [];
  })[0];
  if (!surface || !isJsonString(surface.url)) return undefined;
  const auth = surfaceAuth(surface.auth);
  const apiKey = auth === "headers" ? surfaceApiKey(surface.auth) : undefined;
  return {
    url: surface.url,
    ...(isJsonString(surface.name) ? { name: surface.name } : undefined),
    auth,
    ...(apiKey ? { apiKey } : undefined),
  };
}

interface AuthUse {
  id?: string;
  mechanics?: JsonObject;
  evidence: JsonValue[];
}

function authUses(raw: JsonValue | undefined): AuthUse[] {
  const auth = parseJsonObject(raw);
  return (Array.isArray(auth?.entries) ? auth.entries : []).flatMap((value) => {
    const entry = parseJsonObject(value);
    const uses = Array.isArray(entry?.use) ? entry.use : [];
    const evidence = parseJsonObject(entry?.basis)?.evidence;
    return uses.map((use) => {
      const item = parseJsonObject(use);
      return {
        ...(isJsonString(item?.id) ? { id: item.id } : undefined),
        mechanics: parseJsonObject(item?.mechanics),
        evidence: Array.isArray(evidence) ? evidence : [],
      };
    });
  });
}

function surfaceAuth(raw: JsonValue | undefined): McpSurfaceAuth {
  if (parseJsonObject(raw)?.status === "none") return "none";
  const sources = authUses(raw).map((use) => use.mechanics?.source);
  // Servers that publish OAuth metadata sign in through it; a header-only
  // server needs a key the person pastes.
  if (sources.includes("well-known") || sources.length === 0) return "oauth";
  return sources.includes("http") ? "headers" : "oauth";
}

function surfaceApiKey(
  raw: JsonValue | undefined,
): McpSurfaceApiKey | undefined {
  // Alternatives for the same key are listed side by side; prefer the
  // standard Bearer header when a server takes either.
  const candidates = authUses(raw).flatMap((use) => {
    const mechanics = use.mechanics;
    if (mechanics?.source !== "http" || mechanics.in !== "header") return [];
    const scheme = mechanics.scheme;
    if (scheme !== undefined && scheme !== "Bearer") return [];
    const headerName = isJsonString(mechanics.headerName)
      ? mechanics.headerName
      : scheme === "Bearer"
        ? "Authorization"
        : undefined;
    if (!headerName) return [];
    const docsUrl = use.evidence.find(
      (value): value is string =>
        isJsonString(value) && value.startsWith("https://"),
    );
    return [
      {
        headerName,
        ...(scheme === "Bearer" ? { scheme } : undefined),
        label: keyLabel(use.id),
        ...(docsUrl ? { docsUrl } : undefined),
      } satisfies McpSurfaceApiKey,
    ];
  });
  return candidates.find((item) => item.scheme === "Bearer") ?? candidates[0];
}

const keyLabels: readonly [RegExp, string][] = [
  [/(?:^| )(?:pat|personal (?:access )?token)$/u, "personal access token"],
  [/api ?token$/u, "API token"],
  [/access token$/u, "access token"],
  [/secret key$/u, "secret key"],
  [/access key$/u, "access key"],
  [/token$/u, "API token"],
];

/** "browser_use_api_key" reads as "API key". */
function keyLabel(id: string | undefined) {
  const words = (id ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .join(" ")
    .trim();
  return keyLabels.find(([pattern]) => pattern.test(words))?.[1] ?? "API key";
}
