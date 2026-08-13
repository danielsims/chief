import { useMemo } from "react";

import type { SessionRecord } from "@chief/agent-runtime/types";

import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";
import {
  formatAgentActivityStatus,
  mergeAgentActivityPresence,
  taskAgentActivityPresence,
} from "./agent-activity-presence";

function activityAgentName(agentId: string) {
  return Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, agentId)
    ? WORKSPACE_AGENT_IDENTITIES[
        agentId as keyof typeof WORKSPACE_AGENT_IDENTITIES
      ].name
    : agentId;
}

export function useMainAgentActivity({
  activeRootTurn,
  channelAgentIds,
  directAgentId,
  running,
  statusLabel,
  tasks,
}: {
  activeRootTurn: { agentId: string; threadRootId?: string } | null;
  channelAgentIds?: readonly string[];
  directAgentId?: string;
  running: boolean;
  statusLabel: string;
  tasks: readonly Pick<SessionRecord, "agent" | "id" | "status">[];
}) {
  const agents = useMemo(() => {
    const fallbackRootAgentId =
      directAgentId ??
      (channelAgentIds?.length === 1 ? channelAgentIds[0] : undefined) ??
      (!channelAgentIds ? "chief" : undefined);
    const rootAgentId = activeRootTurn?.agentId ?? fallbackRootAgentId;
    const root =
      running && !activeRootTurn?.threadRootId && rootAgentId
        ? { id: rootAgentId, label: activityAgentName(rootAgentId) }
        : undefined;
    return mergeAgentActivityPresence(
      root,
      taskAgentActivityPresence(tasks, activityAgentName),
    );
  }, [activeRootTurn, channelAgentIds, directAgentId, running, tasks]);

  return {
    agents,
    statusLabel:
      agents.length === 1 && agents[0]?.id === activeRootTurn?.agentId
        ? statusLabel
        : formatAgentActivityStatus(agents),
  };
}
