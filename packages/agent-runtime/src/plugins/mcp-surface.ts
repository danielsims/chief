import type { JsonValue } from "@chief/relay-contracts";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

export type McpSurfaceAuth = "oauth" | "headers" | "none";

/**
 * The remote MCP endpoint an integrations.sh surface document describes, and
 * how it signs in. Shared by the local plugin host and the desktop, so it
 * must stay free of runtime-specific imports.
 */
export function parseMcpSurfaceFromDocument(
  raw: unknown,
): { url: string; name?: string; auth: McpSurfaceAuth } | undefined {
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
    auth: surfaceAuth(surface.auth),
  };
}

function surfaceAuth(raw: JsonValue | undefined): McpSurfaceAuth {
  const auth = parseJsonObject(raw);
  if (auth?.status === "none") return "none";
  const mechanics = (Array.isArray(auth?.entries) ? auth.entries : [])
    .flatMap((entry) => {
      const uses = parseJsonObject(entry)?.use;
      return Array.isArray(uses) ? uses : [];
    })
    .map((use) => parseJsonObject(parseJsonObject(use)?.mechanics)?.source);
  // Servers that publish OAuth metadata sign in through it; a header-only
  // server needs a key the person pastes.
  if (mechanics.includes("well-known") || mechanics.length === 0)
    return "oauth";
  return mechanics.includes("http") ? "headers" : "oauth";
}
