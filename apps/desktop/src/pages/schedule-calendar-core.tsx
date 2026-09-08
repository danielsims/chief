import type {
  ContentDraftRecord,
  RecurringWorkRecord,
} from "@chief/agent-runtime/types";
import { defaultAgents } from "@chief/agent-runtime/agent-roster";
import { cn } from "@chief/ui/lib/utils";

type ScheduledDraft = ContentDraftRecord;
type CalendarView = "month" | "week" | "day";
type ScheduleKind = "post" | "agent-work";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMELINE_START_HOUR = 7;
const TIMELINE_END_HOUR = 20;
const TIMELINE_ROW_HEIGHT = 52;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date: Date) {
  const result = startOfDay(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function addDays(date: Date, count: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function sameMonth(left: Date, right: Date) {
  return monthKey(left) === monthKey(right);
}

function monthLabel(date: Date) {
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function agentName(agentId: string) {
  const agent = defaultAgents.find((candidate) => candidate.id === agentId);
  if (agent) return agent.name;
  return agentId
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function buildMonthCells(month: Date): (Date | null)[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const leading = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const count = Math.ceil((leading + days) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const day = index - leading + 1;
    return day > 0 && day <= days
      ? new Date(month.getFullYear(), month.getMonth(), day)
      : null;
  });
}

function eventSurface(past = false) {
  if (past) {
    return "opacity-65 bg-muted/70 hover:bg-muted shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_4%,transparent)]";
  }
  return "bg-muted/70 hover:bg-muted shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent),0_1px_2px_rgba(0,0,0,0.035)]";
}

function draftAccent(status: ScheduledDraft["status"]) {
  if (status === "published") {
    return "bg-emerald-500";
  }
  if (status === "scheduled") {
    return "bg-cyan-500";
  }
  if (status === "approved") {
    return "bg-violet-500";
  }
  return "bg-zinc-500";
}

function agentWorkAccent(agentId: string) {
  if (agentId === "engineer") {
    return "bg-amber-500";
  }
  if (agentId === "prospector") {
    return "bg-violet-500";
  }
  if (agentId === "content") {
    return "bg-rose-500";
  }
  if (agentId === "brand") {
    return "bg-fuchsia-500";
  }
  if (agentId === "analyst") {
    return "bg-sky-500";
  }
  if (agentId === "ads") {
    return "bg-teal-500";
  }
  if (agentId === "setup") {
    return "bg-emerald-500";
  }
  return "bg-indigo-500";
}

function workStatusLabel(status: RecurringWorkRecord["status"]) {
  if (status === "needs_approval") return "Review";
  if (status === "draft") return "Draft";
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  return "Issue";
}

function CalendarEventContent({
  title,
  time,
  source,
  accent,
  muted = false,
}: {
  title: string;
  time?: string;
  source: string;
  accent: string;
  muted?: boolean;
}) {
  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            accent,
            muted && "opacity-75",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px] leading-[15px] font-medium tracking-[-0.01em]",
            "text-foreground",
          )}
        >
          {title}
        </span>
      </span>
      <span
        className={cn(
          "mt-0.5 block truncate pl-3 text-[9px] leading-[13px] font-normal tracking-[-0.005em]",
          "text-muted-foreground",
        )}
      >
        {time ? <span className="tabular-nums">{time}</span> : null}
        {time && source ? <span aria-hidden="true"> · </span> : null}
        <span className="capitalize">{source}</span>
      </span>
    </span>
  );
}

export {
  addDays,
  addMonths,
  agentName,
  agentWorkAccent,
  buildMonthCells,
  CalendarEventContent,
  dayKey,
  draftAccent,
  eventSurface,
  monthKey,
  monthLabel,
  sameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  TIMELINE_END_HOUR,
  TIMELINE_ROW_HEIGHT,
  TIMELINE_START_HOUR,
  WEEKDAYS,
  workStatusLabel,
};
export type { CalendarView, ScheduledDraft, ScheduleKind };
export { DraftEventContent, WorkEventContent };
function WorkEventContent({
  work,
  time,
  muted,
}: {
  work: RecurringWorkRecord;
  time?: string;
  muted?: boolean;
}) {
  return (
    <CalendarEventContent
      title={work.title}
      time={time}
      source={agentName(work.agentId)}
      accent={agentWorkAccent(work.agentId)}
      muted={muted}
    />
  );
}

function DraftEventContent({
  draft,
  time,
  muted,
}: {
  draft: ScheduledDraft;
  time?: string;
  muted?: boolean;
}) {
  return (
    <CalendarEventContent
      title={draft.title}
      time={time}
      source={draft.platform}
      accent={draftAccent(draft.status)}
      muted={muted}
    />
  );
}

export function workOccurrences(work: RecurringWorkRecord) {
  return [
    ...new Set([...(work.recordedRuns ?? []), ...(work.upcomingRuns ?? [])]),
  ].sort((a, b) => a - b);
}
