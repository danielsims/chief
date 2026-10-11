import { useMemo } from "react";

import type { SessionRecord } from "@chief/agent-runtime/types";
import type { ScheduleRun } from "@chief/relay-contracts";

import type { WorkingAgent } from "../../lib/runtime-chat-controls";
import { useRuntime } from "../../lib/runtime";
import { workspaceAgentName } from "../../lib/workspace-channels";
import {
  formatAgentActivityStatus,
  mergeAgentActivityPresence,
  scheduledAgentActivityPresence,
  taskAgentActivityPresence,
} from "./agent-activity-presence";

export function useMainAgentActivity({
  activeRootTurn,
  channelAgentIds,
  directAgentId,
  running,
  statusLabel,
  tasks,
  scheduleRuns,
  workingAgents,
}: {
  activeRootTurn: { agentId: string; threadRootId?: string } | null;
  channelAgentIds?: readonly string[];
  directAgentId?: string;
  running: boolean;
  statusLabel: string;
  scheduleRuns: readonly ScheduleRun[];
  tasks: readonly Pick<SessionRecord, "agent" | "id" | "status" | "provider">[];
  workingAgents: readonly WorkingAgent[];
}) {
  const { agents: roster } = useRuntime();
  const agents = useMemo(() => {
    const activityAgentName = (agentId: string) =>
      workspaceAgentName(agentId, roster) ?? agentId;
    const fallbackRootAgentId =
      directAgentId ??
      (channelAgentIds?.length === 1 ? channelAgentIds[0] : undefined) ??
      (!channelAgentIds ? "chief" : undefined);
    const rootAgentId = activeRootTurn?.agentId ?? fallbackRootAgentId;
    // An agent DM answers every message in its own thread, so its working
    // state belongs under the main composer, not on the thread.
    const includeThreads = Boolean(directAgentId);
    const root =
      running &&
      (includeThreads || !activeRootTurn?.threadRootId) &&
      rootAgentId
        ? { id: rootAgentId, label: activityAgentName(rootAgentId) }
        : undefined;
    return mergeAgentActivityPresence(root, [
      ...workingAgents
        .filter((agent) => includeThreads || !agent.threadRootId)
        .map((agent) => ({
          id: agent.agentId,
          label: activityAgentName(agent.agentId),
        })),
      ...taskAgentActivityPresence(tasks, activityAgentName),
      ...scheduledAgentActivityPresence(scheduleRuns, activityAgentName),
    ]);
  }, [
    activeRootTurn,
    channelAgentIds,
    directAgentId,
    roster,
    running,
    tasks,
    scheduleRuns,
    workingAgents,
  ]);

  return {
    agents,
    statusLabel:
      agents.length === 1 && agents[0]?.id === activeRootTurn?.agentId
        ? statusLabel
        : formatAgentActivityStatus(agents),
  };
}
