import { LoaderCircle } from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

import type { useDashboardController } from "./use-dashboard-controller";
import type { DashboardOutput } from "./use-dashboard-insights";

type DashboardController = ReturnType<typeof useDashboardController>;
type WorkItem = DashboardController["agentWorkTimeline"][number];

function dayKey(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(new Date(timestamp));
}

function dayLabel(timestamp: number, timezone: string, now: number) {
  const target = dayKey(timestamp, timezone);
  if (target === dayKey(now, timezone)) return "Today";
  if (target === dayKey(now + 86_400_000, timezone)) return "Tomorrow";
  if (target === dayKey(now - 86_400_000, timezone)) return "Yesterday";
  const withinWeek = Math.abs(timestamp - now) < 6 * 86_400_000;
  return new Intl.DateTimeFormat(
    undefined,
    withinWeek
      ? { weekday: "long", timeZone: timezone }
      : { day: "numeric", month: "short", timeZone: timezone },
  ).format(new Date(timestamp));
}

function timeLabel(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(timestamp));
}

/** What the agent is doing, said plainly. */
function workDescription(item: WorkItem, agent: string) {
  if (item.kind === "upcoming") {
    return item.onceAt === undefined ? agent : `${agent}, once`;
  }
  if (item.status === "completed") return `${agent} finished`;
  if (item.status === "failed") return `${agent} ran into a problem`;
  if (item.status === "waiting") return `${agent} needs your input`;
  if (item.taskCount && item.taskCount > 1) {
    return `${agent} is working on ${item.taskCount} tasks`;
  }
  return `${agent} is working`;
}

function workDestination(item: WorkItem) {
  if (item.kind === "upcoming") return "/schedule";
  if (!item.parentId) return "/conversations";
  const thread = item.threadRootId
    ? `&thread=${encodeURIComponent(item.threadRootId)}`
    : item.childId
      ? `&child=${encodeURIComponent(item.childId)}`
      : "";
  return `/conversations?channel=${encodeURIComponent(item.parentId)}${thread}`;
}

interface TimelineRow {
  id: string;
  day: string;
  time: string;
  title: string;
  description: string;
  destination: string;
  running: boolean;
  past: boolean;
}

/**
 * The workspace's day as one list: what's running, what's next, and what the
 * team recently produced. The time column carries the structure.
 */
export function DashboardTimeline({
  agentName,
  navigate,
  now,
  outputs,
  work,
}: {
  agentName: (agentId: string) => string;
  navigate: DashboardController["navigate"];
  now: number;
  outputs: DashboardOutput[];
  work: WorkItem[];
}) {
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const upcoming: TimelineRow[] = work.map((item) => ({
    id: item.id,
    day:
      item.kind === "active"
        ? "Now"
        : dayLabel(item.timestamp, item.timezone, now),
    time:
      item.kind === "active" ? "" : timeLabel(item.timestamp, item.timezone),
    title: item.title,
    description: workDescription(item, agentName(item.agentId)),
    destination: workDestination(item),
    running: item.kind === "active" && item.status === "running",
    past: false,
  }));
  const recent: TimelineRow[] = outputs.map((output) => ({
    id: `output-${output.id}`,
    day: dayLabel(output.updatedAt, localZone, now),
    time: timeLabel(output.updatedAt, localZone),
    title: output.title,
    description: output.agentId ? agentName(output.agentId) : "Your team",
    destination: output.destination,
    running: false,
    past: true,
  }));

  if (upcoming.length === 0 && recent.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing scheduled.{" "}
        <button
          type="button"
          onClick={() => void navigate("/schedule")}
          className="text-foreground underline-offset-4 hover:underline"
        >
          Open schedule
        </button>
      </p>
    );
  }

  return (
    <div>
      <TimelineRows rows={upcoming} navigate={navigate} />
      {upcoming.length > 0 && recent.length > 0 ? (
        <div className="border-border/60 my-3 border-t" />
      ) : null}
      <TimelineRows rows={recent} navigate={navigate} />
    </div>
  );
}

function TimelineRows({
  rows,
  navigate,
}: {
  rows: TimelineRow[];
  navigate: DashboardController["navigate"];
}) {
  return (
    <ol>
      {rows.map((row, index) => {
        const sameDay = index > 0 && rows[index - 1]?.day === row.day;
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => void navigate(row.destination)}
              className="hover:bg-accent/60 -mx-3 grid w-[calc(100%+1.5rem)] grid-cols-[8.5rem_minmax(0,1fr)] items-baseline gap-4 rounded-lg px-3 py-2.5 text-left transition-colors"
            >
              <span className="text-muted-foreground grid grid-cols-[4.75rem_auto] text-xs tabular-nums">
                <span>{sameDay ? "" : row.day}</span>
                <span>{row.time}</span>
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "flex items-center gap-2 text-[13px] leading-5",
                    row.past && "text-foreground/80",
                  )}
                >
                  {row.running ? (
                    <LoaderCircle
                      aria-label="Running"
                      className="text-muted-foreground size-3 shrink-0 animate-spin"
                    />
                  ) : null}
                  <span className="truncate">{row.title}</span>
                </span>
                <span className="text-muted-foreground block truncate text-xs leading-5">
                  {row.description}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
