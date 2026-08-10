import type { DriverType } from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../lib/workspace-channels";
import { WORKSPACE_AGENT_IDENTITIES } from "../lib/workspace-channels";

const CHAT_DRIVERS = new Set<DriverType>([
  "claude",
  "codex",
  "opencode",
  "remote",
]);

export function requestedDriver(value: string | null): DriverType | undefined {
  return value && CHAT_DRIVERS.has(value as DriverType)
    ? (value as DriverType)
    : undefined;
}

export function isWorkspaceAgentId(
  value: string | null,
): value is WorkspaceAgentId {
  return value !== null && Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, value);
}
