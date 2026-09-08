import type { SessionRecord } from "@chief/agent-runtime/types";
import type { ScheduleRun } from "@chief/relay-contracts";

export interface AgentActivityPresence {
  id: string;
  label: string;
  taskId?: string;
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
  tasks: readonly Pick<SessionRecord, "agent" | "id" | "status">[],
  labelFor: (agentId: string) => string,
) {
  return mergeAgentActivityPresence(
    undefined,
    tasks.filter(taskIsActivelyWorking).map((task) => ({
      id: task.agent,
      label: labelFor(task.agent),
      taskId: task.id,
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
