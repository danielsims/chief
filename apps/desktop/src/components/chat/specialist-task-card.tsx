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

export function AgentActivityCard({
  task,
  detail,
  className,
  onOpenTask,
}: {
  task: SessionRecord;
  detail: string;
  className?: string;
  onOpenTask?: (taskId: string) => void;
}) {
  const working = specialistIsStartingOrWorking(task.status);
  return (
    <button
      type="button"
      onClick={() => onOpenTask?.(task.id)}
      className={cn(INLINE_RESULT_CARD_CLASS, "min-h-14 text-xs", className)}
    >
      <SpecialistStatusIndicator
        agent={task.agent}
        className="size-8 rounded-lg"
        size={32}
        status={task.status}
      />
      <span className="min-w-0 flex-1">
        <strong className="block truncate font-medium">
          {taskAgentLabel(task.agent)}
        </strong>
        <small className="text-muted-foreground mt-0.5 block truncate text-[11px] leading-4 font-normal">
          {detail}
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
  return (
    <AgentActivityCard
      task={task}
      detail={specialistStatusLabel(task.status)}
      onOpenTask={onOpenTask}
    />
  );
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
