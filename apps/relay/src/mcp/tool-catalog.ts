import { z } from "zod";

import type { McpToolSummary } from "@chief/relay-contracts";
import { parseMcpSurfaceFromDocument } from "@chief/agent-runtime/mcp-surface";
import { mcpToolSummarySchema } from "@chief/relay-contracts";

import { listMcpTools } from "./client";
import { requirePublicMcpUrl } from "./fetch-guard";

/** A server that listed nothing is asked again after this long. */
const emptyListFreshMs = 24 * 60 * 60 * 1000;

const storedToolsSchema = z.object({
  tools: z.array(mcpToolSummarySchema),
  seenAt: z.number(),
});

function storageKey(domain: string) {
  return `mcp-tool-catalog/${encodeURIComponent(domain.toLowerCase())}.json`;
}

/**
 * Records a server's tools when any workspace connects it, so the catalog can
 * show them to people who haven't connected it yet.
 */
export async function rememberServerTools(
  env: Env,
  domain: string | undefined,
  tools: readonly McpToolSummary[],
) {
  if (!domain || tools.length === 0) return;
  await env.ARTIFACTS.put(
    storageKey(domain),
    JSON.stringify({ tools, seenAt: Date.now() }),
    { httpMetadata: { contentType: "application/json" } },
  ).catch(() => undefined);
}

/**
 * The tools a catalog plugin offers before it is connected: those remembered
 * from an earlier connection, or, for a server that answers without signing
 * in, its own list. Servers that need sign-in return none until connected.
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
    if (
      parsed.success &&
      (parsed.data.tools.length > 0 ||
        Date.now() - parsed.data.seenAt < emptyListFreshMs)
    )
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
  await env.ARTIFACTS.put(
    storageKey(domain),
    JSON.stringify({ tools, seenAt: Date.now() }),
    { httpMetadata: { contentType: "application/json" } },
  ).catch(() => undefined);
  return tools;
}
