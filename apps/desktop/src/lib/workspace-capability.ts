import { useMemo } from "react";

import type { ExecutorCapability } from "@chief/agent-runtime/types";

import { useRelaySession } from "./relay-session";

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

export function useWorkspaceCapability() {
  const { snapshot } = useRelaySession();
  const cloudOrganizationId = snapshot?.id ?? null;
  return useMemo(
    () => ({
      cloudOrganizationId,
      capability: cloudOrganizationId
        ? { apiBaseUrl: "chief-relay://nip98", token: "transport-owned" }
        : null,
      error: null,
    }),
    [cloudOrganizationId],
  );
}
