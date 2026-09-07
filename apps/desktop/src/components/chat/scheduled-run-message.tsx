import { ArrowUpRight } from "lucide-react";

import type { ChiefMessageMetadata } from "@chief/agent-runtime/types";
import type { ScheduleRun } from "@chief/relay-contracts";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";

import { useRuntime } from "../../lib/runtime";
import { AgentAvatar } from "../agent-avatar";

export function ScheduledRunMessage({
  run,
  onOpen,
  progress,
}: {
  run: NonNullable<ChiefMessageMetadata["scheduledRun"]>;
  onOpen?: () => void;
  progress?: ScheduleRun;
}) {
  const { agents } = useRuntime();
  const roster = agents.flatMap((agent) => [agent, ...(agent.subagents ?? [])]);
  const team = progress
    ? [progress.schedule.agentId, ...progress.schedule.collaborators]
    : run.agentIds;
  const working =
    progress?.state === "running"
      ? progress.steps.filter((step) => step.state === "running")
      : [];
  const names = working
    .map(
      (step) =>
        roster.find((agent) => agent.id === step.agentId)?.name ?? step.agentId,
    )
    .join(", ");
  const content = (
    <>
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="shrink-0">Scheduled run</span>
        {working.length > 0 ? (
          <span
            role="status"
            className="ml-auto flex min-w-0 items-center gap-1.5"
          >
            <MatrixLoader size={13} ariaLabel={`${names} working`} />
            <span className="truncate">{names} working</span>
          </span>
        ) : progress?.state === "queued" ? (
          <span className="ml-auto">Queued</span>
        ) : null}
        {onOpen ? (
          <ArrowUpRight size={14} className="ml-auto shrink-0" />
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-5 font-medium">{run.title}</p>
      <div className="mt-3 flex items-center gap-2">
        <span className="flex -space-x-1.5">
          {team.map((id) => (
            <AgentAvatar
              key={id}
              agentId={id}
              label={roster.find((agent) => agent.id === id)?.name ?? id}
              className="ring-background size-5 ring-2"
            />
          ))}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {team
            .map((id) => roster.find((agent) => agent.id === id)?.name ?? id)
            .join(", ")}
        </span>
      </div>
    </>
  );
  const className =
    "border-border/70 bg-card w-full max-w-md rounded-lg border px-4 py-3 text-left";
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className={`${className} hover:bg-muted/40 transition-colors`}
      aria-label={`Open scheduled run: ${run.title}`}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
