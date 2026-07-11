import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ContentDraftRecord,
  RecurringWorkRecord,
} from "@marketer/agent-runtime/types";
import { useNavigate } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@marketer/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@marketer/ui/components/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@marketer/ui/components/popover";
import { cn } from "@marketer/ui/lib/utils";
import {
  Check,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Repeat2,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { Input } from "@marketer/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@marketer/ui/components/select";
import { useAgentConfig } from "../lib/agent-config";
import {
  RunReviewDialog,
  type RunReview,
} from "../components/run-review-dialog";
import { useAuth } from "../lib/auth/auth-context";
import { useAgentChat, useWorkspaceData } from "../lib/runtime";
import { createChat } from "../lib/chat-log";

type ScheduledDraft = ContentDraftRecord;
type CalendarView = "month" | "week" | "day";
type ScheduleKind = "post" | "agent-work";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_BEFORE = 12;
const MONTHS_AFTER = 24;
const WEEKDAY_HEADER_HEIGHT = 36;
const CALENDAR_HEADER_HEIGHT = WEEKDAY_HEADER_HEIGHT;

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

function buildMonthCells(month: Date): Array<Date | null> {
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

function statusClass(status: ScheduledDraft["status"]) {
  if (status === "published") return "bg-emerald-500";
  if (status === "scheduled") return "bg-sky-500";
  if (status === "approved") return "bg-amber-400";
  return "bg-muted-foreground";
}

function DraftChip({ draft }: { draft: ScheduledDraft }) {
  const time = draft.scheduledFor
    ? new Date(draft.scheduledFor).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  return (
    <div className="min-w-0 select-none border bg-background px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn("size-1.5 shrink-0", statusClass(draft.status))} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {draft.title}
        </span>
      </div>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">
        {time} · {draft.platform}
      </p>
    </div>
  );
}

function RecurringWorkChip({
  work,
  onContextMenu,
}: {
  work: RecurringWorkRecord;
  onContextMenu?: (work: RecurringWorkRecord, x: number, y: number) => void;
}) {
  const approvalNeeded =
    work.status === "draft" || work.status === "needs_approval";
  return (
    <div
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(work, event.clientX, event.clientY);
      }}
      className="min-w-0 select-none border bg-card px-2 py-1.5"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 shrink-0",
            approvalNeeded ? "bg-amber-400" : "bg-foreground",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {work.title}
        </span>
      </div>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">
        {work.status === "draft" ? "Approval needed" : work.agentId}
      </p>
    </div>
  );
}

interface PastRunEntry {
  id: string;
  workId: string;
  agentId: string;
  title: string;
  status: "completed" | "failed" | "needs_approval";
  scheduledFor: number;
  summary?: string;
  blockedTools?: string[];
}

/** A finished occurrence stays on the calendar, quietly greyed. */
function PastRunChip({ run }: { run: PastRunEntry }) {
  return (
    <div className="min-w-0 select-none border border-border/60 bg-card/50 px-2 py-1.5 opacity-60">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 shrink-0",
            run.status === "completed"
              ? "bg-muted-foreground"
              : run.status === "failed"
                ? "bg-destructive"
                : "bg-amber-400",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {run.title}
        </span>
      </div>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">
        {run.status === "completed"
          ? "Completed"
          : run.status === "failed"
            ? "Failed"
            : "Needs approval"}
      </p>
    </div>
  );
}

function DayCell({
  date,
  drafts,
  recurringWork,
  pastRuns = [],
  today,
  selected,
  onSelect,
  onContextMenu,
  onWorkContext,
  boundaryRow = false,
  tall = false,
}: {
  date: Date;
  drafts: ScheduledDraft[];
  recurringWork: RecurringWorkRecord[];
  pastRuns?: PastRunEntry[];
  today: Date;
  selected: Date;
  onSelect: (date: Date) => void;
  onContextMenu?: (date: Date, x: number, y: number) => void;
  onWorkContext?: (
    work: RecurringWorkRecord,
    date: Date,
    x: number,
    y: number,
  ) => void;
  boundaryRow?: boolean;
  tall?: boolean;
}) {
  const key = dayKey(date);
  const isToday = key === dayKey(today);
  const isSelected = key === dayKey(selected);
  const visibleLimit = tall ? 8 : boundaryRow ? 2 : 3;
  const workLimit = Math.max(0, visibleLimit - pastRuns.length);
  const draftLimit = Math.max(0, workLimit - recurringWork.length);

  return (
    <button
      type="button"
      onClick={() => onSelect(date)}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(date, event.clientX, event.clientY);
      }}
      className={cn(
        "min-h-28 min-w-0 border-b border-r p-2 text-left align-top transition-colors hover:bg-accent/30",
        tall && "min-h-[420px]",
        isSelected && "bg-accent/40",
      )}
    >
      <span
        className={cn(
          "relative block text-right text-xs leading-none",
          isToday &&
            "font-medium after:absolute after:-bottom-1 after:right-0 after:h-px after:w-3 after:bg-foreground",
        )}
      >
        {date.getDate()}
      </span>
      <div className={cn("min-w-0 space-y-1", boundaryRow ? "mt-8" : "mt-2")}>
        {pastRuns.slice(0, visibleLimit).map((run) => (
          <PastRunChip key={run.id} run={run} />
        ))}
        {recurringWork.slice(0, workLimit).map((work) => (
          <RecurringWorkChip
            key={work.id}
            work={work}
            onContextMenu={
              onWorkContext
                ? (item, x, y) => onWorkContext(item, date, x, y)
                : undefined
            }
          />
        ))}
        {drafts.slice(0, draftLimit).map((draft) => (
          <DraftChip key={draft.id} draft={draft} />
        ))}
        {drafts.length + recurringWork.length + pastRuns.length >
        visibleLimit ? (
          <p className="px-1 text-[10px] text-muted-foreground">
            +
            {drafts.length +
              recurringWork.length +
              pastRuns.length -
              visibleLimit}{" "}
            more
          </p>
        ) : null}
      </div>
    </button>
  );
}

function ScheduleFilters({
  visibleKinds,
  onToggle,
}: {
  visibleKinds: ReadonlySet<ScheduleKind>;
  onToggle: (kind: ScheduleKind) => void;
}) {
  const options: Array<{
    kind: ScheduleKind;
    label: string;
    detail: string;
    color: string;
  }> = [
    {
      kind: "post",
      label: "Posts",
      detail: "Scheduled content",
      color: "bg-sky-500",
    },
    {
      kind: "agent-work",
      label: "Agent work",
      detail: "Recurring proactive actions",
      color: "bg-foreground",
    },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal size={13} />
          Filters
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          Show on schedule
        </p>
        {options.map((option) => {
          const checked = visibleKinds.has(option.kind);
          return (
            <button
              key={option.kind}
              type="button"
              onClick={() => onToggle(option.kind)}
              className="flex w-full items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-accent"
            >
              <span className={cn("size-2 shrink-0", option.color)} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">
                  {option.label}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  {option.detail}
                </span>
              </span>
              <span className="flex size-4 shrink-0 items-center justify-center border">
                {checked ? <Check size={11} /> : null}
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function ContinuousMonthView({
  currentMonth,
  activeMonth,
  onActiveMonthChange,
  today,
  selected,
  onSelect,
  onDateContext,
  onWorkContext,
  byDay,
  recurringByDay,
  pastRunsByDay,
  showPosts,
  showAgentWork,
  scrollRequest,
}: {
  currentMonth: Date;
  activeMonth: Date;
  onActiveMonthChange: (month: Date) => void;
  today: Date;
  selected: Date;
  onSelect: (date: Date) => void;
  onDateContext: (date: Date, x: number, y: number) => void;
  onWorkContext: (
    work: RecurringWorkRecord,
    date: Date,
    x: number,
    y: number,
  ) => void;
  byDay: ReadonlyMap<string, ScheduledDraft[]>;
  recurringByDay: ReadonlyMap<string, RecurringWorkRecord[]>;
  pastRunsByDay: ReadonlyMap<string, PastRunEntry[]>;
  showPosts: boolean;
  showAgentWork: boolean;
  scrollRequest: { month: Date; token: number };
}) {
  const months = useMemo(
    () =>
      Array.from({ length: MONTHS_BEFORE + MONTHS_AFTER + 1 }, (_, index) =>
        addMonths(currentMonth, index - MONTHS_BEFORE),
      ),
    [currentMonth],
  );
  const calendarRef = useRef<HTMLDivElement>(null);
  const monthSections = useRef(new Map<string, HTMLElement>());
  const scrollFrame = useRef<number | null>(null);

  const scrollToMonth = (month: Date, behavior: ScrollBehavior) => {
    const container = calendarRef.current;
    const section = monthSections.current.get(monthKey(month));
    if (!container || !section) return;
    container.scrollTo({
      top: section.offsetTop - CALENDAR_HEADER_HEIGHT,
      behavior,
    });
  };

  useLayoutEffect(() => {
    scrollToMonth(scrollRequest.month, "auto");
    onActiveMonthChange(scrollRequest.month);
  }, [scrollRequest.token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    },
    [],
  );

  const handleScroll = () => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      const container = calendarRef.current;
      if (!container) return;
      const threshold = container.scrollTop + CALENDAR_HEADER_HEIGHT + 2;
      let nextMonth = months[0]!;
      for (const month of months) {
        const section = monthSections.current.get(monthKey(month));
        if (!section || section.offsetTop > threshold) break;
        nextMonth = month;
      }
      if (!sameMonth(nextMonth, activeMonth)) {
        onActiveMonthChange(nextMonth);
      }
    });
  };

  return (
    <div
      ref={calendarRef}
      onScroll={handleScroll}
      className="relative h-full min-w-0 overflow-y-auto overscroll-contain"
    >
      <div className="sticky top-0 z-30 grid h-9 grid-cols-7 border-b bg-background/95 backdrop-blur-lg">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="border-r px-3 py-2 text-[11px] text-muted-foreground last:border-r-0"
          >
            {weekday}
          </div>
        ))}
      </div>

      {months.map((month) => {
        const key = monthKey(month);
        const cells = buildMonthCells(month);
        return (
          <section
            key={key}
            ref={(node) => {
              if (node) monthSections.current.set(key, node);
              else monthSections.current.delete(key);
            }}
            className="relative grid grid-cols-7 border-l"
          >
            <p
              className={cn(
                "pointer-events-none absolute left-3 top-2 z-10 font-serif text-xl transition-opacity duration-300",
                // The page header already names the active month; the in-grid
                // label fades away instead of duplicating it.
                sameMonth(month, activeMonth) && "opacity-0",
              )}
            >
              {monthLabel(month)}
            </p>
            {cells.map((date, index) =>
              date ? (
                <DayCell
                  key={dayKey(date)}
                  date={date}
                  drafts={showPosts ? (byDay.get(dayKey(date)) ?? []) : []}
                  recurringWork={
                    showAgentWork
                      ? (recurringByDay.get(dayKey(date)) ?? [])
                      : []
                  }
                  pastRuns={
                    showAgentWork
                      ? (pastRunsByDay.get(dayKey(date)) ?? [])
                      : []
                  }
                  today={today}
                  selected={selected}
                  onSelect={onSelect}
                  onContextMenu={onDateContext}
                  onWorkContext={onWorkContext}
                  boundaryRow={index < 7}
                />
              ) : (
                <div
                  key={`empty-${index}`}
                  aria-hidden="true"
                  className="min-h-28 border-b border-r bg-muted/[0.025]"
                />
              ),
            )}
          </section>
        );
      })}
    </div>
  );
}

function FocusedCalendarView({
  view,
  selected,
  today,
  onSelect,
  onDateContext,
  onWorkContext,
  byDay,
  recurringByDay,
  pastRunsByDay,
  showPosts,
  showAgentWork,
}: {
  view: Exclude<CalendarView, "month">;
  selected: Date;
  today: Date;
  onSelect: (date: Date) => void;
  onDateContext: (date: Date, x: number, y: number) => void;
  onWorkContext: (
    work: RecurringWorkRecord,
    date: Date,
    x: number,
    y: number,
  ) => void;
  byDay: ReadonlyMap<string, ScheduledDraft[]>;
  recurringByDay: ReadonlyMap<string, RecurringWorkRecord[]>;
  pastRunsByDay: ReadonlyMap<string, PastRunEntry[]>;
  showPosts: boolean;
  showAgentWork: boolean;
}) {
  const dates =
    view === "week"
      ? Array.from({ length: 7 }, (_, index) =>
          addDays(startOfWeek(selected), index),
        )
      : [selected];

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div
        className={cn(
          "sticky top-0 z-20 grid h-9 border-b bg-background/95 backdrop-blur-lg",
          view === "week" ? "grid-cols-7" : "grid-cols-1",
        )}
      >
        {dates.map((date) => (
          <div
            key={dayKey(date)}
            className="border-r px-3 py-2 text-[11px] text-muted-foreground last:border-r-0"
          >
            {date.toLocaleDateString([], { weekday: "short" })}
          </div>
        ))}
      </div>
      <div
        className={cn(
          "grid min-h-[calc(100%-36px)] border-l",
          view === "week" ? "grid-cols-7" : "grid-cols-1",
        )}
      >
        {dates.map((date) => (
          <DayCell
            key={dayKey(date)}
            date={date}
            drafts={showPosts ? (byDay.get(dayKey(date)) ?? []) : []}
            recurringWork={
              showAgentWork ? (recurringByDay.get(dayKey(date)) ?? []) : []
            }
            pastRuns={
              showAgentWork ? (pastRunsByDay.get(dayKey(date)) ?? []) : []
            }
            today={today}
            selected={selected}
            onSelect={onSelect}
            onContextMenu={onDateContext}
            onWorkContext={onWorkContext}
            tall
          />
        ))}
      </div>
    </div>
  );
}

type DateMenuAction = "event" | "content" | "agent" | "recurring";

function CalendarContextMenu({
  context,
  onClose,
  onAction,
}: {
  context: { date: Date; x: number; y: number } | null;
  onClose: () => void;
  onAction: (action: DateMenuAction, date: Date) => void;
}) {
  useEffect(() => {
    if (!context) return;
    const close = () => onClose();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [context, onClose]);

  if (!context) return null;
  const actions: Array<{
    id: DateMenuAction;
    label: string;
    detail: string;
    Icon: typeof CalendarPlus;
  }> = [
    {
      id: "event",
      label: "Add a one-off event",
      detail: "Place something on this date",
      Icon: CalendarPlus,
    },
    {
      id: "content",
      label: "Schedule content",
      detail: "Draft a post for this date",
      Icon: FilePlus2,
    },
    {
      id: "agent",
      label: "Ask an agent to plan",
      detail: "Open this date with your CMO",
      Icon: MessageSquare,
    },
    {
      id: "recurring",
      label: "Set up recurring work",
      detail: "Create an automation with approval",
      Icon: Repeat2,
    },
  ];

  return (
    <div
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed z-50 w-64 border bg-popover p-1.5 text-popover-foreground shadow-md"
      style={{
        left: Math.min(context.x, window.innerWidth - 272),
        top: Math.min(context.y, window.innerHeight - 238),
      }}
    >
      <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
        {context.date.toLocaleDateString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </p>
      {actions.map(({ id, label, detail, Icon }) => (
        <button
          key={id}
          type="button"
          role="menuitem"
          onClick={() => {
            onAction(id, context.date);
            onClose();
          }}
          className="flex w-full items-start gap-3 px-2 py-2 text-left transition-colors hover:bg-accent"
        >
          <Icon size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-xs font-medium">{label}</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              {detail}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function RecurringWorkContextMenu({
  context,
  onClose,
  onSkip,
  onEdit,
  onCancelSeries,
}: {
  context: {
    work: RecurringWorkRecord;
    date: Date;
    x: number;
    y: number;
  } | null;
  onClose: () => void;
  onSkip: (work: RecurringWorkRecord, date: Date) => void;
  onEdit: (work: RecurringWorkRecord) => void;
  onCancelSeries: (work: RecurringWorkRecord) => void;
}) {
  useEffect(() => {
    if (!context) return;
    const close = () => onClose();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [context, onClose]);

  if (!context) return null;
  const { work, date } = context;
  const canSkip = work.status === "active" || work.status === "paused";
  return (
    <div
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed z-50 w-64 border bg-popover p-1.5 text-popover-foreground shadow-md"
      style={{
        left: Math.min(context.x, window.innerWidth - 272),
        top: Math.min(context.y, window.innerHeight - 190),
      }}
    >
      <p className="truncate px-2 py-1.5 text-[10px] text-muted-foreground">
        {work.title}
      </p>
      {canSkip ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onSkip(work, date);
            onClose();
          }}
          className="flex w-full items-start gap-3 px-2 py-2 text-left transition-colors hover:bg-accent"
        >
          <Pause size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-xs font-medium">
              Skip this occurrence
            </span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              {date.toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}{" "}
              only
            </span>
          </span>
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onEdit(work);
          onClose();
        }}
        className="flex w-full items-start gap-3 px-2 py-2 text-left transition-colors hover:bg-accent"
      >
        <Pencil size={14} className="mt-0.5 shrink-0" />
        <span>
          <span className="block text-xs font-medium">Edit schedule</span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            Change the title or timing directly
          </span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onCancelSeries(work);
          onClose();
        }}
        className="flex w-full items-start gap-3 px-2 py-2 text-left transition-colors hover:bg-accent"
      >
        <Trash2 size={14} className="mt-0.5 shrink-0 text-destructive" />
        <span>
          <span className="block text-xs font-medium text-destructive">
            Cancel series
          </span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            Removes the automation and its history
          </span>
        </span>
      </button>
    </div>
  );
}

const CRON_FIELDS = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

type ScheduleFrequency = "daily" | "weekdays" | "weekly" | "monthly" | "custom";

const WEEKDAY_OPTIONS = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

interface ScheduleFields {
  frequency: ScheduleFrequency;
  time: string; // HH:MM
  weekday: string; // 0-6 for weekly
  dayOfMonth: string; // 1-31 for monthly
  custom: string; // raw cron for the escape hatch
}

/** Reads a cron into friendly fields when it matches a simple shape. */
function fieldsFromCron(cron: string): ScheduleFields {
  const fallback: ScheduleFields = {
    frequency: "custom",
    time: "09:00",
    weekday: "1",
    dayOfMonth: "1",
    custom: cron,
  };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const [minute, hour, dom, month, dow] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour) || month !== "*") {
    return fallback;
  }
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (dom === "*" && dow === "*") {
    return { ...fallback, frequency: "daily", time };
  }
  if (dom === "*" && dow === "1-5") {
    return { ...fallback, frequency: "weekdays", time };
  }
  if (dom === "*" && /^[0-6]$/.test(dow)) {
    return { ...fallback, frequency: "weekly", time, weekday: dow };
  }
  if (/^\d{1,2}$/.test(dom) && dow === "*") {
    return { ...fallback, frequency: "monthly", time, dayOfMonth: dom };
  }
  return fallback;
}

function cronFromFields(fields: ScheduleFields): string {
  if (fields.frequency === "custom") return fields.custom.trim();
  const [hour = "9", minute = "0"] = fields.time.split(":");
  const m = String(Number(minute));
  const h = String(Number(hour));
  if (fields.frequency === "daily") return `${m} ${h} * * *`;
  if (fields.frequency === "weekdays") return `${m} ${h} * * 1-5`;
  if (fields.frequency === "weekly") return `${m} ${h} * * ${fields.weekday}`;
  return `${m} ${h} ${Number(fields.dayOfMonth)} * *`;
}

function RecurringWorkEditDialog({
  work,
  onClose,
  onSave,
}: {
  work: RecurringWorkRecord | null;
  onClose: () => void;
  onSave: (
    work: RecurringWorkRecord,
    patch: { title: string; cron: string; timezone: string },
  ) => void;
}) {
  const [title, setTitle] = useState("");
  const [timezone, setTimezone] = useState("");
  const [fields, setFields] = useState<ScheduleFields>(() =>
    fieldsFromCron("0 9 * * *"),
  );

  useEffect(() => {
    if (!work) return;
    setTitle(work.title);
    setTimezone(work.timezone);
    setFields(fieldsFromCron(work.cron));
  }, [work]);

  const cron = cronFromFields(fields);
  const timezoneValid = (() => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  })();
  const dayOfMonthValid =
    fields.frequency !== "monthly" ||
    (Number(fields.dayOfMonth) >= 1 && Number(fields.dayOfMonth) <= 31);
  const valid =
    Boolean(title.trim()) &&
    CRON_FIELDS.test(cron) &&
    timezoneValid &&
    dayOfMonthValid;

  const patch = (next: Partial<ScheduleFields>) =>
    setFields((current) => ({ ...current, ...next }));

  const frequencies: Array<{ value: ScheduleFrequency; label: string }> = [
    { value: "daily", label: "Every day" },
    { value: "weekdays", label: "Weekdays" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <Dialog open={Boolean(work)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {work ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">
                Edit schedule
              </DialogTitle>
              <DialogDescription>
                Change the timing directly, or ask for a change in the
                approval card and the agent will rework it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Title</label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Repeats</label>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={fields.frequency}
                    onValueChange={(value) =>
                      patch({ frequency: value as ScheduleFrequency })
                    }
                  >
                    <SelectTrigger className="h-9 w-36 text-sm">
                      {
                        frequencies.find(
                          (item) => item.value === fields.frequency,
                        )?.label
                      }
                    </SelectTrigger>
                    <SelectContent>
                      {frequencies.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fields.frequency === "weekly" ? (
                    <Select
                      value={fields.weekday}
                      onValueChange={(value) => patch({ weekday: value })}
                    >
                      <SelectTrigger className="h-9 w-32 text-sm">
                        {
                          WEEKDAY_OPTIONS.find(
                            (item) => item.value === fields.weekday,
                          )?.label
                        }
                      </SelectTrigger>
                      <SelectContent>
                        {WEEKDAY_OPTIONS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {fields.frequency === "monthly" ? (
                    <Input
                      value={fields.dayOfMonth}
                      onChange={(event) =>
                        patch({ dayOfMonth: event.target.value })
                      }
                      className="h-9 w-20 text-sm"
                      placeholder="Day"
                    />
                  ) : null}
                  {fields.frequency !== "custom" ? (
                    <Input
                      type="time"
                      value={fields.time}
                      onChange={(event) => patch({ time: event.target.value })}
                      className="h-9 w-28 text-sm"
                    />
                  ) : null}
                </div>
                {fields.frequency === "custom" ? (
                  <div className="space-y-1">
                    <Input
                      value={fields.custom}
                      onChange={(event) =>
                        patch({ custom: event.target.value })
                      }
                      className="font-mono"
                      placeholder="0 8 * * 1"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      minute · hour · day of month · month · day of week
                    </p>
                  </div>
                ) : (
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {cron}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  Timezone
                </label>
                <Input
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  placeholder="Australia/Sydney"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={!valid}
                onClick={() => {
                  onSave(work, {
                    title: title.trim(),
                    cron,
                    timezone: timezone.trim(),
                  });
                  onClose();
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}


function RecurringWorkApprovalDialog({
  work,
  onClose,
  onApprove,
  onReject,
  revision,
}: {
  work: RecurringWorkRecord | null;
  onClose: () => void;
  onApprove: (work: RecurringWorkRecord) => void;
  onReject: (work: RecurringWorkRecord) => void;
  revision: {
    available: boolean;
    busy: boolean;
    note: string | null;
    onRequest: (feedback: string) => void;
  };
}) {
  const [feedback, setFeedback] = useState("");
  const submitFeedback = () => {
    const text = feedback.trim();
    if (!text || revision.busy) return;
    setFeedback("");
    revision.onRequest(text);
  };
  return (
    <Dialog open={Boolean(work)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {work ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">
                Approve recurring work
              </DialogTitle>
              <DialogDescription>
                Approve this once and {work.agentId} will keep running it until
                you pause or revoke it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="border p-4">
                <p className="text-sm font-medium">{work.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {work.approvalSummary}
                </p>
                <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                  {work.cron} · {work.timezone}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium">Delegated actions</p>
                <div className="mt-2 space-y-1.5">
                  {work.proposedToolPatterns.length > 0 ? (
                    work.proposedToolPatterns.map((pattern) => (
                      <div
                        key={pattern}
                        className="flex items-center gap-2 border px-3 py-2"
                      >
                        <ShieldCheck
                          size={13}
                          className="shrink-0 text-emerald-500"
                        />
                        <span className="min-w-0 truncate text-xs">
                          {pattern
                            .split(".")
                            .at(-1)
                            ?.replace(/([A-Z])/g, " $1")}
                        </span>
                        <span className="ml-auto max-w-56 truncate font-mono text-[9px] text-muted-foreground">
                          {pattern}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="border px-3 py-2 text-xs text-muted-foreground">
                      Read connected data and save no external changes.
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                New integration actions are blocked automatically. Marketer will
                ask you to approve an expanded scope before they can run.
              </p>
              {revision.available ? (
                <div className="border-t pt-3">
                  <div className="flex gap-2">
                    <Input
                      value={feedback}
                      onChange={(event) => setFeedback(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitFeedback();
                        }
                      }}
                      placeholder="Ask for a change before approving…"
                      disabled={revision.busy}
                      className="h-8 text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={!feedback.trim() || revision.busy}
                      onClick={submitFeedback}
                    >
                      Send
                    </Button>
                  </div>
                  {revision.busy ? (
                    <p className="agent-working mt-2 font-mono text-xs">
                      updating the plan…
                    </p>
                  ) : revision.note ? (
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {revision.note}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <DialogFooter className="items-center">
              <button
                type="button"
                onClick={() => {
                  onReject(work);
                  onClose();
                }}
                className="mr-auto text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                Reject
              </button>
              <Button variant="outline" onClick={onClose}>
                Not now
              </Button>
              <Button
                disabled={revision.busy}
                onClick={() => {
                  onApprove(work);
                  onClose();
                }}
              >
                Approve and activate
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RecurringWorkDetail({
  work,
  onReview,
  onToggle,
  onRun,
  onPlacement,
}: {
  work: RecurringWorkRecord;
  onReview: () => void;
  onToggle: () => void;
  onRun: () => void;
  onPlacement?: (placement: RecurringWorkRecord["placement"]) => void;
}) {
  const approvalNeeded =
    work.status === "draft" || work.status === "needs_approval";
  return (
    <div className="border p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1 size-1.5 shrink-0 bg-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{work.title}</p>
          <p className="mt-1 text-[10px] capitalize text-muted-foreground">
            {work.agentId} · {work.status.replace("_", " ")}
          </p>
        </div>
      </div>
      {work.lastResult ? (
        <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">
          {work.lastResult}
        </p>
      ) : null}
      <div className="mt-3 flex gap-1.5">
        {approvalNeeded ? (
          <Button size="sm" className="flex-1" onClick={onReview}>
            {work.status === "needs_approval"
              ? "Review run"
              : "Review approval"}
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onRun}>
              <Play size={12} />
              Run now
            </Button>
            <Button variant="outline" size="sm" onClick={onToggle}>
              {work.status === "active" ? (
                <Pause size={12} />
              ) : (
                <Play size={12} />
              )}
              {work.status === "active" ? "Pause" : "Resume"}
            </Button>
          </>
        )}
      </div>
      {!approvalNeeded && onPlacement ? (
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2.5">
          <span className="text-[10px] text-muted-foreground">Runs on</span>
          <div className="flex border p-0.5">
            {(
              [
                { value: "local", label: "This Mac" },
                { value: "cloud", label: "Cloud" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onPlacement(option.value)}
                className={cn(
                  "px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground",
                  work.placement === option.value &&
                    "bg-accent text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {work.placement === "cloud" && !approvalNeeded ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Takes effect on the next workspace deploy.
        </p>
      ) : null}
    </div>
  );
}

export function SchedulePage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const today = useMemo(() => startOfDay(new Date()), []);
  const currentMonth = useMemo(() => startOfMonth(today), [today]);
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<CalendarView>("month");
  const [activeMonth, setActiveMonth] = useState(currentMonth);
  const [monthDirection, setMonthDirection] = useState<1 | -1>(1);
  const [scrollRequest, setScrollRequest] = useState({
    month: currentMonth,
    token: 0,
  });
  const [visibleKinds, setVisibleKinds] = useState<ReadonlySet<ScheduleKind>>(
    () => new Set<ScheduleKind>(["post", "agent-work"]),
  );
  const [approvalWorkId, setApprovalWorkId] = useState<string | null>(null);
  const [runReview, setRunReview] = useState<RunReview | null>(null);
  const [dateMenu, setDateMenu] = useState<{
    date: Date;
    x: number;
    y: number;
  } | null>(null);
  const [workMenu, setWorkMenu] = useState<{
    work: RecurringWorkRecord;
    date: Date;
    x: number;
    y: number;
  } | null>(null);
  const [editWorkId, setEditWorkId] = useState<string | null>(null);
  const { cloudOrganizationId } = useAuth();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const agentConfig = useAgentConfig();
  // Derived from live workspace data so an agent revision streams straight
  // into the open approval card.
  const approvalWork = approvalWorkId
    ? (workspaceData.recurringWork.find((work) => work.id === approvalWorkId) ??
      null)
    : null;
  const revisionDriver = agentConfig.forAgent("cmo").driver;
  const revisionChat = useAgentChat(
    approvalWorkId ? "cmo" : null,
    revisionDriver,
    approvalWorkId ? `revise-recurring-${approvalWorkId}` : undefined,
    "full",
  );
  const revisionNote = useMemo(() => {
    for (let i = revisionChat.chat.items.length - 1; i >= 0; i -= 1) {
      const item = revisionChat.chat.items[i]!;
      if (item.kind !== "assistant") continue;
      const text = item.event.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(" ")
        .trim();
      if (text) return text;
    }
    return null;
  }, [revisionChat.chat.items]);
  const openWorkReview = (work: RecurringWorkRecord) => {
    if (work.status !== "needs_approval") {
      setApprovalWorkId(work.id);
      return;
    }
    const latest = workspaceData.recurringWorkRuns
      .filter((run) => run.recurringWorkId === work.id)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    const attentionItem = workspaceData.attentionItems.find(
      (item) => item.sourceId === `automation-${work.id}`,
    );
    setRunReview({
      title: work.title,
      agentId: work.agentId,
      recurringWorkId: work.id,
      attentionItemId: attentionItem?.id,
      detail:
        latest?.summary ??
        latest?.error ??
        work.lastResult ??
        "The last run stopped before finishing.",
      status: latest?.status ?? "needs_approval",
      at: latest?.startedAt ?? work.lastRunAt,
      blockedTools: latest?.blockedTools ?? [],
    });
  };

  const requestRevision = (feedback: string) => {
    if (!approvalWork) return;
    const draft = {
      id: approvalWork.id,
      agentId: approvalWork.agentId,
      title: approvalWork.title,
      cron: approvalWork.cron,
      timezone: approvalWork.timezone,
      instructions: approvalWork.instructions,
      approvalSummary: approvalWork.approvalSummary,
      proposedToolPatterns: approvalWork.proposedToolPatterns,
    };
    revisionChat.send(
      [
        "The user is reviewing a draft recurring-work approval and asked for a change before approving.",
        `Current draft (JSON): ${JSON.stringify(draft)}`,
        `Feedback: "${feedback}"`,
        `Right now it is ${new Date().toString()}.`,
        "Apply the feedback by calling the recurringWorkPropose local tool with the SAME id and ALL fields (id, title, agentId, cron, timezone, instructions, approvalSummary, proposedToolPatterns), changing only what the feedback requires. Then reply with one short sentence stating exactly what changed. Do not ask questions.",
      ].join("\n"),
    );
  };

  const workDateKeyIn = (timestamp: number, timezone: string) => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(timestamp));
    } catch {
      return dayKey(new Date(timestamp));
    }
  };
  const skipOccurrence = (work: RecurringWorkRecord, date: Date) => {
    const cellKey = dayKey(date);
    const occurrence = (work.upcomingRuns ?? []).find(
      (timestamp) => dayKey(new Date(timestamp)) === cellKey,
    );
    const skipKey = occurrence
      ? workDateKeyIn(occurrence, work.timezone)
      : cellKey;
    const skipDates = work.skipDates ?? [];
    if (skipDates.includes(skipKey)) return;
    workspaceData.saveRecurringWork({
      ...work,
      skipDates: [...skipDates, skipKey],
      updatedAt: Date.now(),
    });
  };
  const editWork = editWorkId
    ? (workspaceData.recurringWork.find((work) => work.id === editWorkId) ??
      null)
    : null;

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduledDraft[]>();
    for (const draft of workspaceData.drafts) {
      if (!draft.scheduledFor) continue;
      const key = dayKey(new Date(draft.scheduledFor));
      const items = map.get(key) ?? [];
      items.push(draft);
      map.set(key, items);
    }
    for (const items of map.values()) {
      items.sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));
    }
    return map;
  }, [workspaceData.drafts]);

  const recurringByDay = useMemo(() => {
    const map = new Map<string, RecurringWorkRecord[]>();
    for (const work of workspaceData.recurringWork) {
      for (const timestamp of work.upcomingRuns ?? []) {
        const key = dayKey(new Date(timestamp));
        const items = map.get(key) ?? [];
        if (!items.some((item) => item.id === work.id)) items.push(work);
        map.set(key, items);
      }
    }
    return map;
  }, [workspaceData.recurringWork]);

  const pastRunsByDay = useMemo(() => {
    const works = new Map(
      workspaceData.recurringWork.map((work) => [work.id, work]),
    );
    const map = new Map<string, PastRunEntry[]>();
    for (const run of workspaceData.recurringWorkRuns) {
      if (run.status === "running") continue;
      const key = dayKey(new Date(run.scheduledFor));
      const items = map.get(key) ?? [];
      items.push({
        id: run.id,
        workId: run.recurringWorkId,
        agentId: works.get(run.recurringWorkId)?.agentId ?? "cmo",
        title: works.get(run.recurringWorkId)?.title ?? "Automation",
        status: run.status,
        scheduledFor: run.scheduledFor,
        summary: run.summary ?? run.error ?? undefined,
        blockedTools: run.blockedTools,
      });
      map.set(key, items);
    }
    return map;
  }, [workspaceData.recurringWork, workspaceData.recurringWorkRuns]);

  const showPosts = visibleKinds.has("post");
  const showAgentWork = visibleKinds.has("agent-work");
  const selectedDrafts = showPosts ? (byDay.get(dayKey(selected)) ?? []) : [];
  const selectedRecurringWork = showAgentWork
    ? (recurringByDay.get(dayKey(selected)) ?? [])
    : [];
  const selectedPastRuns = showAgentWork
    ? [...(pastRunsByDay.get(dayKey(selected)) ?? [])].sort(
        (a, b) => a.scheduledFor - b.scheduledFor,
      )
    : [];
  // Initial proposals only. A run that stopped mid-flight is reviewed from
  // the Overview digest or the automation's own card, not this list.
  const pendingApprovals = workspaceData.recurringWork.filter(
    (work) => work.status === "draft",
  );

  const requestMonth = (month: Date) => {
    setMonthDirection(month > activeMonth ? 1 : -1);
    setScrollRequest((current) => ({ month, token: current.token + 1 }));
    setActiveMonth(month);
  };

  const openAgentForDate = (
    agentId: string,
    title: string,
    text: string,
    send = false,
  ) => {
    const chat = createChat(agentId, title);
    navigate(
      `/conversations?agent=${agentId}&chat=${chat.id}&new=1&${send ? "prompt" : "draft"}=${encodeURIComponent(text)}`,
    );
  };

  const handleDateAction = (action: DateMenuAction, date: Date) => {
    const dateText = date.toLocaleDateString("en-AU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (action === "content") {
      openAgentForDate(
        "content",
        `Content for ${dateText}`,
        `Draft and schedule a piece of content for ${dateText}.`,
      );
      return;
    }
    if (action === "recurring") {
      openAgentForDate(
        "cmo",
        "Set up recurring work",
        `Help me set up recurring marketing work, beginning around ${dateText}. Ask only for the outcome or timing if genuinely needed, configure everything else, then create one narrow approval for Schedule.`,
        true,
      );
      return;
    }
    openAgentForDate(
      "cmo",
      action === "event" ? `Event on ${dateText}` : `Plan ${dateText}`,
      action === "event"
        ? `Add a one-off marketing calendar event on ${dateText}. Ask me only for the missing event details, then save it to the schedule.`
        : `Help me plan the marketing work and content for ${dateText}.`,
    );
  };

  const move = (direction: number) => {
    if (view === "month") {
      requestMonth(addMonths(activeMonth, direction));
      return;
    }
    setSelected((date) => addDays(date, direction * (view === "week" ? 7 : 1)));
  };

  const focusedHeading =
    view === "week"
      ? `${startOfWeek(selected).toLocaleDateString([], { month: "short", day: "numeric" })} – ${addDays(startOfWeek(selected), 6).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
      : selected.toLocaleDateString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        });

  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-5 border-b px-8 pb-5 pt-4">
        <div>
          <h1 className="font-serif text-3xl">Schedule</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Planned content and recurring agent work.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const chat = createChat("cmo", "Set up recurring work");
              const draft =
                "Set up recurring work for me. Ask only for the outcome or timing if you genuinely need it, configure everything else yourself, then create one narrow approval for me to review in Schedule.";
              navigate(
                `/conversations?agent=cmo&chat=${chat.id}&new=1&prompt=${encodeURIComponent(draft)}`,
              );
            }}
          >
            <Plus size={13} />
            New recurring work
          </Button>
          <ScheduleFilters
            visibleKinds={visibleKinds}
            onToggle={(kind) => {
              setVisibleKinds((current) => {
                const next = new Set(current);
                if (next.has(kind)) next.delete(kind);
                else next.add(kind);
                return next;
              });
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelected(today);
              if (view === "month") requestMonth(currentMonth);
            }}
          >
            Today
          </Button>
          <div className="flex border p-0.5">
            {(["month", "week", "day"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={cn(
                  "px-3 py-1.5 text-xs capitalize text-muted-foreground transition-colors hover:text-foreground",
                  view === option && "bg-accent text-foreground",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="relative h-7 min-w-0 flex-1 overflow-hidden">
          <AnimatePresence
            initial={false}
            mode="popLayout"
            custom={monthDirection}
          >
            <motion.p
              key={view === "month" ? monthKey(activeMonth) : focusedHeading}
              initial={
                reduceMotion ? false : { y: monthDirection * 20, opacity: 0 }
              }
              animate={{ y: 0, opacity: 1 }}
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { y: monthDirection * -20, opacity: 0 }
              }
              transition={{
                type: "spring",
                stiffness: 440,
                damping: 38,
                mass: 0.7,
              }}
              className="absolute inset-x-0 min-w-0 truncate font-serif text-xl"
            >
              {view === "month" ? monthLabel(activeMonth) : focusedHeading}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => move(-1)}>
            <ChevronLeft size={15} />
          </Button>
          <Button variant="outline" size="icon" onClick={() => move(1)}>
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <section className="min-w-0 overflow-hidden">
          {view === "month" ? (
            <ContinuousMonthView
              currentMonth={currentMonth}
              activeMonth={activeMonth}
              onActiveMonthChange={(month) => {
                setMonthDirection(month > activeMonth ? 1 : -1);
                setActiveMonth(month);
              }}
              today={today}
              selected={selected}
              onSelect={setSelected}
              onWorkContext={(work, date, x, y) =>
                setWorkMenu({ work, date, x, y })
              }
              onDateContext={(date, x, y) => {
                setSelected(date);
                setDateMenu({ date, x, y });
              }}
              byDay={byDay}
              recurringByDay={recurringByDay}
              pastRunsByDay={pastRunsByDay}
              showPosts={showPosts}
              showAgentWork={showAgentWork}
              scrollRequest={scrollRequest}
            />
          ) : (
            <FocusedCalendarView
              view={view}
              selected={selected}
              today={today}
              onSelect={setSelected}
              onWorkContext={(work, date, x, y) =>
                setWorkMenu({ work, date, x, y })
              }
              onDateContext={(date, x, y) => {
                setSelected(date);
                setDateMenu({ date, x, y });
              }}
              byDay={byDay}
              recurringByDay={recurringByDay}
              pastRunsByDay={pastRunsByDay}
              showPosts={showPosts}
              showAgentWork={showAgentWork}
            />
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-l p-5">
          {pendingApprovals.length > 0 ? (
            <div className="mb-6 space-y-2 border-b pb-5">
              <p className="text-xs text-muted-foreground">
                Needs your approval
              </p>
              {pendingApprovals.map((work) => (
                <RecurringWorkDetail
                  key={work.id}
                  work={work}
                  onReview={() => setApprovalWorkId(work.id)}
                  onRun={() => {}}
                  onToggle={() => {}}
                />
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {selected.toLocaleDateString([], { weekday: "long" })}
          </p>
          <h2 className="mt-1 font-serif text-2xl">
            {selected.toLocaleDateString([], { month: "long", day: "numeric" })}
          </h2>
          <div className="mt-6 space-y-2">
            {selectedPastRuns.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() =>
                  setRunReview({
                    title: run.title,
                    agentId: run.agentId,
                    recurringWorkId: run.workId,
                    detail: run.summary ?? "No summary was recorded.",
                    status: run.status,
                    at: run.scheduledFor,
                    blockedTools: run.blockedTools ?? [],
                  })
                }
                className="w-full border p-3 text-left opacity-60 transition-opacity hover:opacity-100"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-1 size-1.5 shrink-0",
                      run.status === "completed"
                        ? "bg-muted-foreground"
                        : run.status === "failed"
                          ? "bg-destructive"
                          : "bg-amber-400",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-xs font-medium">
                        {run.title}
                      </p>
                      <p className="shrink-0 text-[10px] text-muted-foreground">
                        {new Date(run.scheduledFor).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    {run.summary ? (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                        {run.summary}
                      </p>
                    ) : null}
                  </div>
                </div>
              </button>
            ))}
            {selectedDrafts.map((draft) => (
              <DraftChip key={draft.id} draft={draft} />
            ))}
            {selectedRecurringWork.map((work) => (
              <RecurringWorkDetail
                key={work.id}
                work={work}
                onReview={() => openWorkReview(work)}
                onRun={() => workspaceData.runRecurringWorkNow(work.id)}
                onToggle={() =>
                  workspaceData.saveRecurringWork({
                    ...work,
                    status: work.status === "active" ? "paused" : "active",
                    updatedAt: Date.now(),
                  })
                }
                onPlacement={(placement) =>
                  workspaceData.saveRecurringWork({
                    ...work,
                    placement,
                    updatedAt: Date.now(),
                  })
                }
              />
            ))}
            {selectedPastRuns.length === 0 &&
            selectedDrafts.length === 0 &&
            selectedRecurringWork.length === 0 ? (
              <div className="flex min-h-[420px] items-center justify-center text-center">
                <p className="text-sm text-muted-foreground">
                  Nothing scheduled
                </p>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
      <RunReviewDialog
        review={runReview}
        onClose={() => setRunReview(null)}
        onDismiss={(target) => {
          if (target.attentionItemId) {
            workspaceData.dismissAttentionItem(target.attentionItemId);
          }
        }}
        onAllowAndRerun={(target) => {
          if (target.recurringWorkId) {
            workspaceData.expandRecurringWorkGrant(
              target.recurringWorkId,
              target.blockedTools,
              true,
            );
          }
        }}
      />
      <RecurringWorkApprovalDialog
        work={approvalWork}
        onClose={() => setApprovalWorkId(null)}
        onApprove={(work) =>
          workspaceData.saveRecurringWork({
            ...work,
            status: "active",
            grant: {
              version: 1,
              approvedAt: Date.now(),
              toolPatterns: work.proposedToolPatterns,
            },
            updatedAt: Date.now(),
          })
        }
        onReject={(work) => workspaceData.deleteRecurringWork(work.id)}
        revision={{
          available: Boolean(revisionDriver),
          busy: revisionChat.chat.status === "running",
          note: revisionNote,
          onRequest: requestRevision,
        }}
      />
      <CalendarContextMenu
        context={dateMenu}
        onClose={() => setDateMenu(null)}
        onAction={handleDateAction}
      />
      <RecurringWorkContextMenu
        context={workMenu}
        onClose={() => setWorkMenu(null)}
        onSkip={skipOccurrence}
        onEdit={(work) => setEditWorkId(work.id)}
        onCancelSeries={(work) => workspaceData.deleteRecurringWork(work.id)}
      />
      <RecurringWorkEditDialog
        work={editWork}
        onClose={() => setEditWorkId(null)}
        onSave={(work, patch) =>
          workspaceData.saveRecurringWork({
            ...work,
            ...patch,
            updatedAt: Date.now(),
          })
        }
      />
    </div>
  );
}
