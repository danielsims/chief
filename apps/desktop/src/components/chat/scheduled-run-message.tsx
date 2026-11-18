import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleX,
  RotateCcw,
  X,
} from "lucide-react";

import type { ChiefMessageMetadata } from "@chief/agent-runtime/types";
import type { ScheduleRun } from "@chief/relay-contracts";
import { walkAutomation } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import { useRelaySession } from "../../lib/relay-session-context";
import { useRuntime } from "../../lib/runtime";
import { insetBandClass, insetCardClass } from "../inset-card";

type StepState = "pending" | "running" | "completed" | "failed" | "skipped";

interface RunStep {
  id: string;
  title: string;
  state: StepState;
}

/** The run's steps: an automation's own, or the team's hand-offs for a brief. */
function runSteps(
  progress: ScheduleRun,
  agentName: (id: string) => string,
): RunStep[] {
  const automation = progress.schedule.automation;
  if (automation)
    return [...walkAutomation(automation.steps)].map(({ step }) => ({
      id: step.id,
      title: step.title,
      state: progress.automation?.nodes[step.id]?.state ?? "pending",
    }));
  return progress.steps.map((step) => ({
    id: step.id,
    title: agentName(step.agentId),
    state: step.state,
  }));
}

function duration(from?: number, to?: number) {
  if (!from) return "";
  const seconds = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Ticks once a second while a run is going; only the clock on screen moves. */
function useElapsed(from: number | undefined, to: number | undefined) {
  const live = Boolean(from && !to);
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);
  return duration(from, to);
}

/**
 * A scheduled or test run of an automation, as one live line: what it's doing
 * now, how far it has got, and every step on demand.
 */
export function ScheduledRunMessage({
  run,
  onOpen,
  progress,
}: {
  run: NonNullable<ChiefMessageMetadata["scheduledRun"]>;
  onOpen?: () => void;
  progress?: ScheduleRun;
}) {
  const { client } = useRelaySession();
  const { agents } = useRuntime();
  const roster = agents.flatMap((agent) => [agent, ...(agent.subagents ?? [])]);
  const agentName = (id: string) =>
    roster.find((agent) => agent.id === id)?.name ?? id;
  const state = progress?.state ?? "queued";
  const failed = state === "failed";
  const [open, setOpen] = useState(failed);
  const [busy, setBusy] = useState(false);
  const elapsed = useElapsed(progress?.startedAt, progress?.completedAt);

  const steps = progress ? runSteps(progress, agentName) : [];
  const done = steps.filter(
    (step) => step.state === "completed" || step.state === "skipped",
  ).length;
  const current =
    steps.find((step) => step.state === "running") ??
    steps.find((step) => step.state === "failed");

  const line: { icon: ReactNode; label: string; quiet?: boolean } =
    state === "running"
      ? {
          icon: <MatrixLoader size={14} ariaLabel="Running" />,
          label: current?.title ?? "Working",
        }
      : state === "queued"
        ? {
            icon: (
              <MatrixLoader
                size={14}
                ariaLabel="Starting"
                color="var(--muted-foreground)"
              />
            ),
            label: "Starting",
            quiet: true,
          }
        : state === "completed"
          ? {
              icon: <Check size={15} className="text-emerald-500" />,
              label: steps.at(-1)?.title ?? "Done",
            }
          : state === "blocked"
            ? {
                icon: <CircleAlert size={14} className="text-amber-500" />,
                label: "Needs you",
              }
            : failed
              ? {
                  icon: <X size={15} className="text-destructive" />,
                  label: current ? `${current.title} failed` : "Failed",
                }
              : {
                  icon: <CircleX size={14} className="text-muted-foreground" />,
                  label: "Cancelled",
                  quiet: true,
                };

  const act = (action: "cancel" | "retry") => {
    if (!client || !progress || busy) return;
    setBusy(true);
    void client.schedules
      .runAction(progress.scheduleId, progress.id, action)
      .catch((error: unknown) =>
        console.warn(`[Automation run] ${action} failed:`, error),
      )
      .finally(() => setBusy(false));
  };

  const hint = progress?.test ? "Test" : state === "queued" ? "" : elapsed;

  return (
    <section
      aria-label={`Automation run: ${run.title}`}
      className={cn(insetBandClass, "block w-full max-w-md text-left")}
    >
      <span className="text-muted-foreground flex h-7 items-center gap-2 px-2.5 text-[12px]">
        <span className="min-w-0 flex-1 truncate">{run.title}</span>
      </span>
      <div className={insetCardClass}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          disabled={steps.length === 0}
          aria-expanded={open}
          className="flex w-full items-center gap-2.5 text-left"
        >
          <span
            role="status"
            className="flex size-5 shrink-0 items-center justify-center"
          >
            {line.icon}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] font-medium",
              line.quiet && "text-muted-foreground",
            )}
          >
            {line.label}
          </span>
          {steps.length > 0 ? (
            <>
              <span className="text-muted-foreground text-[12px] leading-4 font-normal tabular-nums">
                {done} of {steps.length}
              </span>
              <ChevronDown
                size={12}
                className={cn(
                  "text-muted-foreground transition-transform",
                  !open && "-rotate-90",
                )}
              />
            </>
          ) : null}
        </button>
        {state === "blocked" && progress?.summary ? (
          <p className="text-muted-foreground mt-2 pl-[30px] text-[12px] leading-4">
            {progress.summary}
          </p>
        ) : null}
        {open && steps.length > 0 ? (
          <ol className="border-border mt-3 space-y-1.5 border-t pt-2.5 text-[12px]">
            {steps.map((step) => (
              <li key={step.id} className="flex items-center gap-2.5">
                <span className="flex size-5 justify-center">
                  {step.state === "completed" ? (
                    <Check size={12} className="text-emerald-500" />
                  ) : step.state === "failed" ? (
                    <X size={12} className="text-destructive" />
                  ) : step.state === "running" ? (
                    <MatrixLoader size={10} ariaLabel="Running" />
                  ) : (
                    <span className="bg-foreground/20 mt-1.5 size-1 rounded-full" />
                  )}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    (step.state === "pending" || step.state === "skipped") &&
                      "text-muted-foreground",
                  )}
                >
                  {step.title}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      <span className="flex min-h-9 items-center gap-1.5 px-2.5 pt-1 text-[12px]">
        <span className="text-muted-foreground min-w-0 flex-1 truncate tabular-nums">
          {hint}
        </span>
        {(state === "running" || state === "queued") && progress ? (
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => act("cancel")}
          >
            Cancel
          </Button>
        ) : null}
        {(failed || state === "blocked") && progress ? (
          <Button size="xs" disabled={busy} onClick={() => act("retry")}>
            <RotateCcw size={12} /> Retry
          </Button>
        ) : null}
        {onOpen ? (
          <Button size="xs" variant="outline" onClick={onOpen}>
            Open <ArrowUpRight size={12} />
          </Button>
        ) : null}
      </span>
    </section>
  );
}
