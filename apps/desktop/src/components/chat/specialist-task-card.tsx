import { ArrowRight } from "lucide-react";

import type { SessionRecord } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { INLINE_RESULT_CARD_CLASS } from "./inline-result-card";
import {
  specialistIsStartingOrWorking,
  SpecialistStatusIndicator,
} from "./specialist-status-indicator";

export function taskAgentLabel(agent: string) {
  if (agent === "brand") return "Marketer";
  if (agent === "content") return "Content Writer";
  if (agent === "analyst") return "Analyst";
  if (agent === "prospector") return "Prospector";
  if (agent === "ads") return "Ads Manager";
  if (agent === "engineer") return "Engineer";
  if (agent === "setup") return "Setup";
  return agent
    .replace(/[-_]+/gu, " ")
    .replace(/^./u, (first) => first.toLocaleUpperCase());
}

function specialistStatusLabel(status: SessionRecord["status"]) {
  if (status === "idle") return "Starting";
  if (status === "running") return "Working";
  if (status === "waiting") return "Waiting for you";
  if (status === "needs_approval") return "Waiting for approval";
  if (status === "completed") return "Complete";
  return "Failed";
}

export function taskActivitySubtitle(
  task: Pick<SessionRecord, "agent" | "status" | "title">,
) {
  const agent = taskAgentLabel(task.agent);
  const subject =
    task.title.trim().toLocaleLowerCase() === agent.toLocaleLowerCase()
      ? agent
      : `${task.title} · ${agent}`;
  return `${subject} · ${specialistStatusLabel(task.status)}`;
}

function minutes(from?: number, to?: number) {
  if (!from) return "";
  const elapsed = Math.max(1, Math.round(((to ?? Date.now()) - from) / 60_000));
  return `${elapsed} min`;
}

/** What the card says under the task: live while working, the outcome after. */
function taskDetail(task: SessionRecord): {
  text: string;
  tone?: "attention" | "error";
} {
  if (task.status === "idle") return { text: "Starting" };
  if (task.status === "running")
    return {
      text: ["Working", minutes(task.startedAt)].filter(Boolean).join(" · "),
    };
  if (task.status === "waiting")
    return { text: "Waiting for you", tone: "attention" };
  if (task.status === "needs_approval")
    return { text: "Waiting for approval", tone: "attention" };
  if (task.status === "failed") {
    const error = task.error?.trim();
    if (error) return { text: error, tone: "error" };
    return { text: "Couldn't finish", tone: "error" };
  }
  const summary = task.summary?.trim();
  if (summary) return { text: summary };
  return {
    text: ["Finished", minutes(task.startedAt, task.finishedAt)]
      .filter(Boolean)
      .join(" in "),
  };
}

export function AgentActivityCard({
  task,
  detail,
  className,
  onOpenTask,
}: {
  task: SessionRecord;
  detail?: string;
  className?: string;
  onOpenTask?: (taskId: string) => void;
}) {
  const working = specialistIsStartingOrWorking(task.status);
  const agent = taskAgentLabel(task.agent);
  const title =
    task.title.trim() &&
    task.title.trim().toLocaleLowerCase() !== agent.toLocaleLowerCase()
      ? `${agent} · ${task.title.trim()}`
      : agent;
  const status = detail ? { text: detail } : taskDetail(task);
  return (
    <button
      type="button"
      onClick={() => onOpenTask?.(task.id)}
      className={cn(INLINE_RESULT_CARD_CLASS, "min-h-14", className)}
    >
      <SpecialistStatusIndicator
        agent={task.agent}
        className="size-8 rounded-lg"
        size={32}
        status={task.status}
      />
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[13px] leading-5 font-medium">
          {title}
        </strong>
        <small
          className={cn(
            "text-muted-foreground block truncate text-[12px] leading-4 font-normal",
            status.tone === "attention" && "text-amber-600 dark:text-amber-500",
            status.tone === "error" && "text-destructive",
          )}
        >
          {status.text}
        </small>
      </span>
      <ArrowRight
        aria-hidden
        className="text-muted-foreground/55 shrink-0"
        size={12}
      />
      <span className="sr-only">
        {working ? "Open live activity" : "Open activity history"}
      </span>
    </button>
  );
}

export function SpecialistTaskCard({
  task,
  onOpenTask,
}: {
  task: SessionRecord;
  onOpenTask?: (taskId: string) => void;
}) {
  return <AgentActivityCard task={task} onOpenTask={onOpenTask} />;
}

export function ThreadSpecialistTaskCard({
  task,
  onOpenTask,
}: {
  task: SessionRecord;
  onOpenTask?: (taskId: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl py-1 pl-11">
      <SpecialistTaskCard task={task} onOpenTask={onOpenTask} />
    </div>
  );
}
