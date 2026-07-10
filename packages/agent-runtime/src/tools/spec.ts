import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CapabilityAuth,
  IntegrationToolSource,
  McpServerSpec,
} from "../types.js";

const TOOL_AGENTS = new Set(["analyst", "cmo", "ads"]);

/**
 * Materialize the workspace's connected integrations as one scoped MCP server.
 * The agent sees capabilities, never OAuth tokens or Convex credentials.
 */
export function marketerToolServer(
  agentId: string,
  sources: IntegrationToolSource[] = [],
  auth?: CapabilityAuth,
): McpServerSpec | null {
  if (!TOOL_AGENTS.has(agentId) || sources.length === 0) return null;

  const here = dirname(fileURLToPath(import.meta.url));
  const packageRoot = join(here, "..", "..");
  return {
    name: "marketer",
    command: join(packageRoot, "node_modules", ".bin", "tsx"),
    args: [join(here, "mcp-server.ts")],
    env: {
      MARKETER_AGENT_ID: agentId,
      MARKETER_TOOL_SOURCES: JSON.stringify(sources),
      ...(auth
        ? {
            MARKETER_CONVEX_URL: auth.convexUrl,
            MARKETER_CONVEX_TOKEN: auth.convexToken,
          }
        : {}),
    },
  };
}
