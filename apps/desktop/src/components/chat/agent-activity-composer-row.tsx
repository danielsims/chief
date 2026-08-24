import { MatrixLoader } from "@chief/ui/components/matrix-loader";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { AgentActivityPresence } from "./agent-activity-presence";
import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";
import { formatAgentActivityStatus } from "./agent-activity-presence";

function activityColor(agentId: string) {
  return Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, agentId)
    ? WORKSPACE_AGENT_IDENTITIES[agentId as WorkspaceAgentId].color
    : "currentColor";
}

export function AgentActivityComposerRow({
  agents,
  agentLabel = "Chief",
  running,
  statusLabel,
  onOpen,
}: {
  agents?: readonly AgentActivityPresence[];
  agentLabel?: string;
  running: boolean;
  statusLabel: string;
  onOpen: () => void;
}) {
  const visibleAgents =
    agents && agents.length > 0
      ? agents
      : [{ id: agentLabel.toLocaleLowerCase(), label: agentLabel }];
  const visibleStatusLabel =
    visibleAgents.length > 1
      ? formatAgentActivityStatus(visibleAgents)
      : statusLabel;
  if (!running || !visibleStatusLabel.trim()) {
    return <div className="h-8 shrink-0" aria-hidden="true" />;
  }

  return (
    <div
      className="flex h-8 shrink-0 items-center px-1"
      aria-live="polite"
      aria-atomic="true"
    >
      <button
        type="button"
        onClick={onOpen}
        className="group/activity text-muted-foreground hover:text-foreground flex max-w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors duration-150"
        aria-label={`${visibleStatusLabel}. View activity.`}
      >
        <span className="flex shrink-0 items-center -space-x-1">
          {visibleAgents.slice(0, 2).map((agent) => (
            <span
              key={agent.id}
              className="ring-background grid size-[18px] place-items-center rounded-md bg-current/10 text-current ring-1"
              style={{ color: activityColor(agent.id) }}
            >
              <MatrixLoader ariaLabel={`${agent.label} is working`} size={13} />
            </span>
          ))}
        </span>
        {visibleAgents.length > 2 ? (
          <span className="text-muted-foreground shrink-0 text-[9px] font-medium">
            +{visibleAgents.length - 2}
          </span>
        ) : null}
        <span className="chief-shimmer-text min-w-0 truncate text-[11px] font-medium">
          {visibleStatusLabel}
        </span>
        <span className="text-muted-foreground/70 shrink-0 text-[10px] opacity-0 transition-opacity group-hover/activity:opacity-100 group-focus-visible/activity:opacity-100">
          View activity
        </span>
      </button>
    </div>
  );
}
