import type { ExecutorCapability } from "@chief/agent-runtime/types";

export interface ScopedWorkspaceCapability {
  workspaceId: string;
  capability: ExecutorCapability;
}

/** Prevent a capability from the previous workspace escaping during a switch. */
export function capabilityForWorkspace(
  workspaceId: string | null,
  scoped: ScopedWorkspaceCapability | null,
) {
  return scoped?.workspaceId === workspaceId ? scoped.capability : null;
}
