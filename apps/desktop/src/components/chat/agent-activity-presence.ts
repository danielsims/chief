import type { SessionRecord } from "@chief/agent-runtime/types";
import type { ScheduleRun } from "@chief/relay-contracts";

import {
  isWorkspaceAgentId,
  WORKSPACE_AGENT_IDENTITIES,
} from "../../lib/workspace-channels";

export interface AgentActivityPresence {
  id: string;
  label: string;
  taskId?: string;
}

// White identities (Chief) follow the text colour so they stay visible in light mode.
export function agentLoaderColor(agentId: string) {
  const color = isWorkspaceAgentId(agentId)
    ? WORKSPACE_AGENT_IDENTITIES[agentId].color
    : undefined;
  return color?.toLowerCase() === "#ffffff" ? undefined : color;
}

export function taskIsActivelyWorking(task: Pick<SessionRecord, "status">) {
  return task.status === "running";
}

export function mergeAgentActivityPresence(
  root: AgentActivityPresence | undefined,
  tasks: readonly AgentActivityPresence[],
) {
  const agents: AgentActivityPresence[] = [];
  const seen = new Set<string>();
  for (const agent of root ? [root, ...tasks] : tasks) {
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    agents.push(agent);
  }
  return agents;
}

export function taskAgentActivityPresence(
  tasks: readonly Pick<SessionRecord, "agent" | "id" | "status" | "provider">[],
  labelFor: (agentId: string) => string,
) {
  return mergeAgentActivityPresence(
    undefined,
    tasks.filter(taskIsActivelyWorking).map((task) => ({
      id: task.agent,
      label: labelFor(task.agent),
      // A relay job has no local transcript to open. Its tool calls and
      // thinking arrive as conversation activity, shown in the Activity panel.
      ...(task.provider === "relay" ? undefined : { taskId: task.id }),
    })),
  );
}

export function formatAgentActivityStatus(
  agents: readonly Pick<AgentActivityPresence, "label">[],
) {
  const labels = agents.map((agent) => agent.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return `${labels[0]} is working…`;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]} are working…`;
  if (labels.length === 3) {
    return `${labels[0]}, ${labels[1]}, and ${labels[2]} are working…`;
  }
  return `${labels[0]}, ${labels[1]}, and ${labels.length - 2} others are working…`;
}

export function scheduledAgentActivityPresence(
  runs: readonly Pick<ScheduleRun, "state" | "threadRootId" | "steps">[],
  labelFor: (id: string) => string,
  threadRootId?: string | null,
) {
  return mergeAgentActivityPresence(
    undefined,
    runs
      .filter(
        (run) =>
          run.state === "running" &&
          (!threadRootId || run.threadRootId === threadRootId),
      )
      .flatMap((run) =>
        run.steps
          .filter((step) => step.state === "running")
          .map((step) => ({ id: step.agentId, label: labelFor(step.agentId) })),
      ),
  );
}
