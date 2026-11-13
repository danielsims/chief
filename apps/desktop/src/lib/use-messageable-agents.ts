import { useMemo } from "react";

import { useOwnedAgents } from "../components/chat/owned-agents-value";
import { useAuth } from "./auth/auth-context";
import { ownedAgentDefinition } from "./owned-agent-presentation";
import { useRelaySession } from "./relay-session";
import { useRuntime } from "./runtime";
import { useWorkspaceRole } from "./workspace-role";

/** Agents you can DM: the workspace's, plus the outside agents you own. */
export function useMessageableAgents() {
  const { agents } = useRuntime();
  const owned = useOwnedAgents();
  const { user } = useAuth();
  return useMemo(
    () => [
      ...agents,
      ...owned
        .filter((agent) => agent.owner.userId === user?.id)
        .map(ownedAgentDefinition),
    ],
    [agents, owned, user?.id],
  );
}

/** Whether an agent (or subagent) is yours to manage. Agents created before
 * per-person ownership belong to the workspace's creator, its owner. */
export function useIsOwnAgent() {
  const { snapshot } = useRelaySession();
  const owned = useOwnedAgents();
  const { user } = useAuth();
  const role = useWorkspaceRole();
  return (agentId: string) => {
    const external = owned.find((agent) => agent.id === agentId);
    if (external) return external.owner.userId === user?.id;
    const agent = snapshot?.agents.find(
      (candidate) =>
        candidate.id === agentId ||
        candidate.subagents.some((child) => child.id === agentId),
    );
    if (!agent) return false;
    return agent.ownerUserId
      ? agent.ownerUserId === user?.id
      : role === "owner";
  };
}
