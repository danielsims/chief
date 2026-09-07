import { useMemo } from "react";

import type { SessionRecord } from "@chief/agent-runtime/types";
import type { ScheduleRun } from "@chief/relay-contracts";

import {
  isWorkspaceAgentId,
  WORKSPACE_AGENT_IDENTITIES,
} from "../../lib/workspace-channels";
import {
  formatAgentActivityStatus,
  mergeAgentActivityPresence,
  scheduledAgentActivityPresence,
  taskAgentActivityPresence,
} from "./agent-activity-presence";

function activityAgentName(agentId: string) {
  return isWorkspaceAgentId(agentId)
    ? WORKSPACE_AGENT_IDENTITIES[agentId].name
    : agentId;
}

export function useMainAgentActivity({
  activeRootTurn,
  channelAgentIds,
  directAgentId,
  running,
  statusLabel,
  tasks,
  scheduleRuns,
}: {
  activeRootTurn: { agentId: string; threadRootId?: string } | null;
  channelAgentIds?: readonly string[];
  directAgentId?: string;
  running: boolean;
  statusLabel: string;
  scheduleRuns: readonly ScheduleRun[];
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
    return mergeAgentActivityPresence(root, [
      ...taskAgentActivityPresence(tasks, activityAgentName),
      ...scheduledAgentActivityPresence(scheduleRuns, activityAgentName),
    ]);
  }, [
    activeRootTurn,
    channelAgentIds,
    directAgentId,
    running,
    tasks,
    scheduleRuns,
  ]);

  return {
    agents,
    statusLabel:
      agents.length === 1 && agents[0]?.id === activeRootTurn?.agentId
        ? statusLabel
        : formatAgentActivityStatus(agents),
  };
}
