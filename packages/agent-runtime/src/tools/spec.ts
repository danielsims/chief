import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { McpServerSpec } from "../types.js";
import type { ExecutorWorkspace } from "./control-plane.js";

const moduleDirectory =
  typeof __dirname === "string"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

export function executorBinary(): string {
  if (process.env.CHIEF_EXECUTOR_BINARY) {
    return process.env.CHIEF_EXECUTOR_BINARY;
  }
  if (process.env.CHIEF_RUNTIME_ROOT) {
    return join(
      process.env.CHIEF_RUNTIME_ROOT,
      "node_modules",
      ".bin",
      "executor",
    );
  }
  return join(
    moduleDirectory,
    "..",
    "..",
    "node_modules",
    ".bin",
    "executor",
  );
}

/**
 * The workspace daemon also serves streamable-HTTP MCP at <origin>/mcp with
 * the same bearer auth as its REST API (see executor.sh/docs/local/cli).
 */
function executorHttpEndpoint(
  workspace: ExecutorWorkspace,
): { url: string; headers: Record<string, string> } | null {
  try {
    const manifest = JSON.parse(
      readFileSync(
        join(workspace.dataDir, "server-control", "server.json"),
        "utf8",
      ),
    ) as {
      connection?: {
        origin?: string;
        auth?: { kind?: string; token?: string };
      };
    };
    const origin = manifest.connection?.origin;
    const token =
      manifest.connection?.auth?.kind === "bearer"
        ? manifest.connection.auth.token
        : undefined;
    if (!origin || !token) return null;
    return {
      url: `${origin}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
    };
  } catch {
    return null;
  }
}

/**
 * Executor is the only agent-facing tool server. Its stdio process talks to
 * the workspace's isolated daemon; provider credentials remain in Executor.
 * The spec also carries the daemon's HTTP MCP endpoint for drivers that
 * cannot spawn stdio servers.
 */
export function executorToolServer(
  workspace: ExecutorWorkspace,
): McpServerSpec {
  const http = executorHttpEndpoint(workspace);
  return {
    name: "executor",
    command: executorBinary(),
    args: ["mcp", "--scope", workspace.scopeDir, "--elicitation-mode", "model"],
    env: { EXECUTOR_DATA_DIR: workspace.dataDir },
    ...(http ?? {}),
  };
}
