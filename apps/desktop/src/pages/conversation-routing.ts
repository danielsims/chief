import type { DriverType } from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../lib/workspace-channels";
import { WORKSPACE_AGENT_IDENTITIES } from "../lib/workspace-channels";

function isDriverType(value: string): value is DriverType {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "opencode" ||
    value === "remote"
  );
}

export function requestedDriver(value: string | null): DriverType | undefined {
  return value && isDriverType(value) ? value : undefined;
}

export function isWorkspaceAgentId(
  value: string | null,
): value is WorkspaceAgentId {
  return value !== null && Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, value);
}
