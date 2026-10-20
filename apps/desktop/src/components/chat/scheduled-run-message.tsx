import { ArrowUpRight } from "lucide-react";

import type { ChiefMessageMetadata } from "@chief/agent-runtime/types";
import type { ScheduleRun } from "@chief/relay-contracts";
import { walkAutomation } from "@chief/relay-contracts";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import { useRuntime } from "../../lib/runtime";
import { AgentAvatar } from "../agent-avatar";
import { insetBandClass, insetCardClass } from "../inset-card";

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
  // A tool step has no agent working, but the run is still busy with it.
  const activeStep =
    progress?.state === "running"
      ? [...walkAutomation(progress.schedule.automation?.steps ?? [])].find(
          ({ step }) =>
            progress.automation?.nodes[step.id]?.state === "running",
        )?.step
      : undefined;
  const failed = progress?.state === "failed" || progress?.state === "blocked";
  const names = working
    .map(
      (step) =>
        roster.find((agent) => agent.id === step.agentId)?.name ?? step.agentId,
    )
    .join(", ");
  const status =
    working.length > 0 ? (
      <span role="status" className="flex min-w-0 items-center gap-1.5">
        <MatrixLoader size={12} ariaLabel={`${names} working`} />
        <span className="truncate">{names} working</span>
      </span>
    ) : activeStep ? (
      <span role="status" className="flex min-w-0 items-center gap-1.5">
        <MatrixLoader size={12} ariaLabel={activeStep.title} />
        <span className="truncate">{activeStep.title}</span>
      </span>
    ) : progress?.state === "queued" ? (
      "Queued"
    ) : failed ? (
      <span className="text-destructive">Failed</span>
    ) : progress?.state === "completed" ? (
      "Done"
    ) : null;
  const content = (
    <>
      <span className="text-muted-foreground flex h-7 items-center gap-2 px-2.5 text-[12px]">
        <span className="shrink-0">
          {progress?.test ? "Test run" : "Scheduled run"}
        </span>
        <span className="ml-auto flex min-w-0 items-center gap-2">
          {status}
          {onOpen ? <ArrowUpRight size={13} className="shrink-0" /> : null}
        </span>
      </span>
      <span className={cn(insetCardClass, "block")}>
        <span className="block text-sm leading-5 font-medium">{run.title}</span>
        {failed && progress.summary ? (
          <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-4">
            {progress.summary}
          </span>
        ) : null}
        <span className="mt-2.5 flex items-center gap-2">
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
        </span>
      </span>
    </>
  );
  const className = cn(insetBandClass, "block w-full max-w-md text-left");
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        className,
        "transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_14%,transparent)]",
      )}
      aria-label={`Open scheduled run: ${run.title}`}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
