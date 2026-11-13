import { z } from "zod";

import type { McpToolSummary } from "@chief/relay-contracts";
import { parseMcpSurfaceFromDocument } from "@chief/agent-runtime/mcp-surface";
import { mcpToolSummarySchema } from "@chief/relay-contracts";

import { listMcpTools } from "./client";
import { requirePublicMcpUrl } from "./fetch-guard";

/** How long a server's public list is reused before it is asked again. */
const listFreshMs = 24 * 60 * 60 * 1000;

const storedToolsSchema = z.object({
  tools: z.array(mcpToolSummarySchema),
  seenAt: z.number(),
});

function storageKey(domain: string) {
  return `mcp-public-tools/${encodeURIComponent(domain.toLowerCase())}.json`;
}

/**
 * The tools a catalog plugin offers before it is connected: the list its
 * server gives without signing in, cached for every workspace. Lists fetched
 * with a workspace's own credentials never go here, since they can describe
 * that account and the domain on a connection is whatever its admin typed.
 */
export async function catalogServerTools(
  env: Env,
  domain: string,
  relayHost: string,
): Promise<McpToolSummary[]> {
  const stored = await env.ARTIFACTS.get(storageKey(domain));
  if (stored) {
    const parsed = storedToolsSchema.safeParse(
      await stored.json().catch(() => null),
    );
    if (parsed.success && Date.now() - parsed.data.seenAt < listFreshMs)
      return parsed.data.tools;
  }
  let tools: McpToolSummary[] = [];
  try {
    const response = await fetch(
      `https://integrations.sh/api/${encodeURIComponent(domain)}/surface`,
      { headers: { accept: "application/json" } },
    );
    const surface = response.ok
      ? parseMcpSurfaceFromDocument(await response.json())
      : undefined;
    // Servers that need sign-in refuse quickly; the rest answer with their list.
    if (surface) {
      const url = requirePublicMcpUrl(surface.url, relayHost);
      tools = await listMcpTools({
        url: url.toString(),
        limits: { relayHost, maxBytes: 512_000, timeoutMs: 10_000 },
      });
    }
  } catch {
    tools = [];
  }
  // Any member can ask about any domain, so only real lists are kept.
  if (tools.length === 0) return tools;
  await env.ARTIFACTS.put(
    storageKey(domain),
    JSON.stringify({ tools, seenAt: Date.now() }),
    { httpMetadata: { contentType: "application/json" } },
  ).catch(() => undefined);
  return tools;
}
