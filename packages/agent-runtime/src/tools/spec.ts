import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { McpServerSpec } from "../types.js";
import type { ExecutorWorkspace } from "./control-plane.js";

export function executorBinary(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "node_modules", ".bin", "executor");
}

/**
 * Executor is the only agent-facing tool server. Its stdio process talks to
 * the workspace's isolated daemon; provider credentials remain in Executor.
 */
export function executorToolServer(
  workspace: ExecutorWorkspace,
): McpServerSpec {
  return {
    name: "executor",
    command: executorBinary(),
    args: ["mcp", "--scope", workspace.scopeDir, "--elicitation-mode", "model"],
    env: { EXECUTOR_DATA_DIR: workspace.dataDir },
  };
}
