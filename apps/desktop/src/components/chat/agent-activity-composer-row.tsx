import { MatrixLoader } from "@chief/ui/components/matrix-loader";

import type { AgentActivityPresence } from "./agent-activity-presence";
import {
  agentLoaderColor,
  formatAgentActivityStatus,
} from "./agent-activity-presence";

export function AgentActivityComposerRow({
  agents,
  agentLabel = "Chief",
  running,
  statusLabel,
  idleLabel,
  onOpen,
}: {
  agents?: readonly AgentActivityPresence[];
  agentLabel?: string;
  running: boolean;
  statusLabel: string;
  /** Shown quietly once the work is done, so its activity stays reachable. */
  idleLabel?: string;
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
  if (!running && idleLabel) {
    return (
      <div className="flex h-8 shrink-0 items-center px-1">
        <button
          type="button"
          onClick={onOpen}
          className="text-muted-foreground/80 hover:text-foreground flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-medium transition-colors duration-150"
        >
          <span className="truncate">{idleLabel}</span>
          <span aria-hidden="true">·</span>
          <span>View activity</span>
        </button>
      </div>
    );
  }
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
        <span className="flex shrink-0 items-center gap-1">
          {visibleAgents.slice(0, 4).map((agent) => (
            <MatrixLoader
              key={agent.id}
              ariaLabel={`${agent.label} is working`}
              color={agentLoaderColor(agent.id)}
              size={13}
            />
          ))}
        </span>
        {visibleAgents.length > 4 ? (
          <span className="text-muted-foreground shrink-0 text-[9px] font-medium">
            +{visibleAgents.length - 4}
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
