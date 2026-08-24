import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import type { McpServerSpec } from "../types.js";
import type { ExecutorWorkspace } from "./control-plane.js";

const moduleDirectory = import.meta.dirname;

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
  return join(moduleDirectory, "..", "..", "node_modules", ".bin", "executor");
}

/**
 * The workspace daemon also serves streamable-HTTP MCP at <origin>/mcp with
 * the same bearer auth as its REST API (see executor.sh/docs/local/cli).
 */
function executorHttpEndpoint(
  workspace: ExecutorWorkspace,
  elicitationMode: "browser" | "model",
): { url: string; headers: Record<string, string> } | null {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(
        join(workspace.dataDir, "server-control", "server.json"),
        "utf8",
      ),
    );
    if (!isJsonObject(manifest) || !isJsonObject(manifest.connection)) {
      return null;
    }
    const { origin, auth } = manifest.connection;
    const token =
      isJsonObject(auth) && auth.kind === "bearer" && isJsonString(auth.token)
        ? auth.token
        : undefined;
    if (!isJsonString(origin) || !token) return null;
    const url = new URL("/mcp", origin);
    url.searchParams.set("elicitation_mode", elicitationMode);
    return {
      url: url.toString(),
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
  elicitationMode: "browser" | "model" = "browser",
): McpServerSpec {
  const http = executorHttpEndpoint(workspace, elicitationMode);
  return {
    name: "executor",
    command: executorBinary(),
    args: [
      "mcp",
      "--scope",
      workspace.scopeDir,
      "--elicitation-mode",
      elicitationMode,
    ],
    env: {
      EXECUTOR_DATA_DIR: workspace.dataDir,
      EXECUTOR_KEYCHAIN_SERVICE_NAME: workspace.keychainServiceName,
    },
    ...(http ?? {}),
  };
}
