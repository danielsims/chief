/* eslint-disable max-lines */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Inbox,
  MessageSquare,
  Pause,
  Pencil,
  Plus,
  Repeat2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router";

import type {
  ContentDraftRecord,
  RecurringWorkRecord,
} from "@chief/agent-runtime/types";
import { defaultAgents } from "@chief/agent-runtime/agent-roster";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

import { AgentWorkingIndicator } from "../components/chat/agent-working-indicator";
import { useAgentConfig } from "../lib/agent-config";
import { useAuth } from "../lib/auth/auth-context";
import { createChat } from "../lib/chat-log";
import { messageBlocks, useChiefChat, useWorkspaceData } from "../lib/runtime";

type ScheduledDraft = ContentDraftRecord;
type CalendarView = "month" | "week" | "day";
type ScheduleKind = "post" | "agent-work";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_BEFORE = 12;
const MONTHS_AFTER = 24;
const WEEKDAY_HEADER_HEIGHT = 36;
const CALENDAR_HEADER_HEIGHT = WEEKDAY_HEADER_HEIGHT;
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

function draftTone(status: ScheduledDraft["status"], past = false) {
  if (past) {
    return "bg-zinc-200 text-zinc-600 shadow-[inset_0_1px_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.04)] hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600";
  }
  if (status === "published") {
    return "bg-emerald-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.16),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-emerald-700";
  }
  if (status === "scheduled") {
    return "bg-cyan-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.16),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-cyan-700";
  }
  if (status === "approved") {
    return "bg-violet-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.16),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-violet-700";
  }
  return "bg-zinc-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-zinc-700";
}

function agentWorkTone(agentId: string, past = false) {
  if (past) {
    return "bg-zinc-200 text-zinc-600 shadow-[inset_0_1px_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.04)] hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600";
  }
  if (agentId === "prospector") {
    return "bg-violet-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-violet-700";
  }
  if (agentId === "content") {
    return "bg-rose-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-rose-700";
  }
  if (agentId === "brand") {
    return "bg-fuchsia-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-fuchsia-700";
  }
  if (agentId === "analyst") {
    return "bg-sky-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-sky-700";
  }
  if (agentId === "ads") {
    return "bg-teal-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-teal-700";
  }
  if (agentId === "setup") {
    return "bg-emerald-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-emerald-700";
  }
  return "bg-indigo-600 text-white shadow-[inset_0_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-indigo-700";
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
  status,
  agentInitial,
  muted = false,
}: {
  title: string;
  time?: string;
  source: string;
  status: string;
  agentInitial?: string;
  muted?: boolean;
}) {
  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px] leading-[15px] font-semibold tracking-[-0.012em]",
            muted ? "text-zinc-700 dark:text-zinc-200" : "text-white",
          )}
        >
          {title}
        </span>
        {time ? (
          <span
            className={cn(
              "shrink-0 text-[9px] leading-[13px] font-medium tabular-nums",
              muted ? "text-zinc-500 dark:text-zinc-400" : "text-white/75",
            )}
          >
            {time}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[9px] leading-[13px] font-medium tracking-[-0.005em]">
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 truncate capitalize",
            muted ? "text-zinc-500 dark:text-zinc-400" : "text-white/75",
          )}
        >
          {agentInitial ? (
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-full text-[7px] leading-none font-semibold",
                muted
                  ? "bg-zinc-500/12 text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                  : "bg-white/16 text-white",
              )}
            >
              {agentInitial}
            </span>
          ) : null}
          <span className="truncate">{source}</span>
        </span>
        <span
          className={cn(
            "shrink-0",
            muted ? "text-zinc-500 dark:text-zinc-400" : "text-white/90",
          )}
        >
          {status}
        </span>
      </span>
    </span>
  );
}

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
      status={workStatusLabel(work.status)}
      agentInitial={agentName(work.agentId).slice(0, 1)}
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
  const status =
    draft.status === "published"
      ? "Published"
      : draft.status === "scheduled"
        ? "Scheduled"
        : draft.status === "approved"
          ? "Approved"
          : "Draft";
  return (
    <CalendarEventContent
      title={draft.title}
      time={time}
      source={draft.platform}
      status={status}
      agentInitial={agentName(draft.agentId).slice(0, 1)}
      muted={muted}
    />
  );
}

function DraftChip({
  draft,
  onOpen,
  past = false,
}: {
  draft: ScheduledDraft;
  onOpen: (draft: ScheduledDraft) => void;
  past?: boolean;
}) {
  const time = draft.scheduledFor
    ? new Date(draft.scheduledFor).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(draft);
      }}
      className={cn(
        "block min-h-11 w-full min-w-0 rounded-[10px] px-2.5 py-2 text-left transition-colors select-none",
        draftTone(draft.status, past),
      )}
    >
      <DraftEventContent draft={draft} time={time || undefined} muted={past} />
    </button>
  );
}

function RecurringWorkChip({
  work,
  onOpen,
  onContextMenu,
  past = false,
}: {
  work: RecurringWorkRecord;
  onOpen?: (work: RecurringWorkRecord) => void;
  onContextMenu?: (work: RecurringWorkRecord, x: number, y: number) => void;
  past?: boolean;
}) {
  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={(event) => {
        if (!onOpen) return;
        event.stopPropagation();
        onOpen(work);
      }}
      onKeyDown={(event) => {
        if (!onOpen || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen(work);
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(work, event.clientX, event.clientY);
      }}
      className={cn(
        "min-h-11 min-w-0 rounded-[10px] px-2.5 py-2 transition-colors select-none",
        agentWorkTone(work.agentId, past),
      )}
    >
      <WorkEventContent work={work} muted={past} />
    </div>
  );
}

function DayCell({
  date,
  drafts,
  recurringWork,
  today,
  now,
  selected,
  onSelect,
  onContextMenu,
  onWorkOpen,
  onDraftOpen,
  onWorkContext,
  boundaryRow = false,
  tall = false,
}: {
  date: Date;
  drafts: ScheduledDraft[];
  recurringWork: RecurringWorkRecord[];
  today: Date;
  now: number;
  selected: Date;
  onSelect: (date: Date) => void;
  onContextMenu?: (date: Date, x: number, y: number) => void;
  onWorkOpen?: (work: RecurringWorkRecord) => void;
  onDraftOpen: (draft: ScheduledDraft) => void;
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
  const draftLimit = Math.max(0, visibleLimit - recurringWork.length);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(date)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(date);
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(date, event.clientX, event.clientY);
      }}
      className={cn(
        "hover:bg-accent/25 focus-visible:bg-accent/35 min-h-28 min-w-0 border-r border-b border-black/[0.055] p-2 text-left align-top transition-colors outline-none dark:border-white/[0.055]",
        tall && "min-h-[420px]",
        isSelected && "bg-accent/30",
      )}
    >
      <span
        className={cn(
          "ml-auto flex size-6 items-center justify-center rounded-full text-[11px] leading-none",
          isToday && "bg-foreground text-background font-semibold",
          isSelected && !isToday && "bg-accent font-semibold",
        )}
      >
        {date.getDate()}
      </span>
      <div className={cn("min-w-0 space-y-1", boundaryRow ? "mt-8" : "mt-2")}>
        {recurringWork.slice(0, visibleLimit).map((work) => (
          <RecurringWorkChip
            key={work.id}
            work={work}
            onOpen={onWorkOpen}
            past={date < today}
            onContextMenu={
              onWorkContext
                ? (item, x, y) => onWorkContext(item, date, x, y)
                : undefined
            }
          />
        ))}
        {drafts.slice(0, draftLimit).map((draft) => (
          <DraftChip
            key={draft.id}
            draft={draft}
            onOpen={onDraftOpen}
            past={draft.scheduledFor !== undefined && draft.scheduledFor < now}
          />
        ))}
        {drafts.length + recurringWork.length > visibleLimit ? (
          <p className="text-muted-foreground px-1 text-[10px]">
            +{drafts.length + recurringWork.length - visibleLimit} more
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ScheduleFilters({
  visibleKinds,
  onToggle,
}: {
  visibleKinds: ReadonlySet<ScheduleKind>;
  onToggle: (kind: ScheduleKind) => void;
}) {
  const options: {
    kind: ScheduleKind;
    label: string;
    detail: string;
    color: string;
  }[] = [
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
        <p className="text-muted-foreground px-2 py-1.5 text-[10px] tracking-wide uppercase">
          Show on schedule
        </p>
        {options.map((option) => {
          const checked = visibleKinds.has(option.kind);
          return (
            <button
              key={option.kind}
              type="button"
              onClick={() => onToggle(option.kind)}
              className="hover:bg-accent flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors"
            >
              <span className={cn("size-2 shrink-0", option.color)} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">
                  {option.label}
                </span>
                <span className="text-muted-foreground block text-[10px]">
                  {option.detail}
                </span>
              </span>
              <span className="flex size-4 shrink-0 items-center justify-center rounded-md shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent)]">
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
  now,
  selected,
  onSelect,
  onDateContext,
  onWorkOpen,
  onDraftOpen,
  onWorkContext,
  byDay,
  recurringByDay,
  showPosts,
  showAgentWork,
  scrollRequest,
}: {
  currentMonth: Date;
  activeMonth: Date;
  onActiveMonthChange: (month: Date) => void;
  today: Date;
  now: number;
  selected: Date;
  onSelect: (date: Date) => void;
  onDateContext: (date: Date, x: number, y: number) => void;
  onWorkOpen: (work: RecurringWorkRecord) => void;
  onDraftOpen: (draft: ScheduledDraft) => void;
  onWorkContext: (
    work: RecurringWorkRecord,
    date: Date,
    x: number,
    y: number,
  ) => void;
  byDay: ReadonlyMap<string, ScheduledDraft[]>;
  recurringByDay: ReadonlyMap<string, RecurringWorkRecord[]>;
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
    const top =
      container.scrollTop +
      section.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      CALENDAR_HEADER_HEIGHT;
    container.scrollTo({
      top,
      behavior,
    });
  };

  useLayoutEffect(() => {
    scrollToMonth(
      scrollRequest.month,
      scrollRequest.token === 0 ? "auto" : "smooth",
    );
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
      const threshold =
        container.getBoundingClientRect().top + CALENDAR_HEADER_HEIGHT + 4;
      let nextMonth = months[0]!;
      for (const month of months) {
        const section = monthSections.current.get(monthKey(month));
        if (!section || section.getBoundingClientRect().top > threshold) break;
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
      className="relative h-full min-w-0 touch-pan-y [scrollbar-width:thin] [scrollbar-gutter:stable] overflow-y-scroll overscroll-contain scroll-smooth"
    >
      <div className="bg-card/90 sticky top-0 z-30 grid h-10 grid-cols-7 border-b border-black/[0.055] backdrop-blur-xl dark:border-white/[0.055]">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="text-muted-foreground border-r border-black/[0.055] px-3 py-2.5 text-[11px] font-medium last:border-r-0 dark:border-white/[0.055]"
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
            className="relative grid grid-cols-7 border-l border-black/[0.055] dark:border-white/[0.055]"
          >
            <button
              type="button"
              onClick={() => {
                scrollToMonth(month, "smooth");
                onActiveMonthChange(month);
              }}
              className={cn(
                "hover:text-muted-foreground absolute top-2.5 left-3 z-10 text-left text-lg font-semibold tracking-[-0.025em] transition-[color,opacity] duration-200",
                // The page header already names the active month; the in-grid
                // label fades away instead of duplicating it.
                sameMonth(month, activeMonth) &&
                  "pointer-events-none opacity-0",
              )}
            >
              {monthLabel(month)}
            </button>
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
                  today={today}
                  now={now}
                  selected={selected}
                  onSelect={onSelect}
                  onContextMenu={onDateContext}
                  onWorkOpen={onWorkOpen}
                  onDraftOpen={onDraftOpen}
                  onWorkContext={onWorkContext}
                  boundaryRow={index < 7}
                />
              ) : (
                <div
                  key={`empty-${index}`}
                  aria-hidden="true"
                  className="bg-muted/[0.025] min-h-28 border-r border-b border-black/[0.055] dark:border-white/[0.055]"
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
  now,
  onSelect,
  onDateContext,
  onWorkOpen,
  onDraftOpen,
  onWorkContext,
  byDay,
  recurringByDay,
  showPosts,
  showAgentWork,
}: {
  view: Exclude<CalendarView, "month">;
  selected: Date;
  today: Date;
  now: number;
  onSelect: (date: Date) => void;
  onDateContext: (date: Date, x: number, y: number) => void;
  onWorkOpen: (work: RecurringWorkRecord) => void;
  onDraftOpen: (draft: ScheduledDraft) => void;
  onWorkContext: (
    work: RecurringWorkRecord,
    date: Date,
    x: number,
    y: number,
  ) => void;
  byDay: ReadonlyMap<string, ScheduledDraft[]>;
  recurringByDay: ReadonlyMap<string, RecurringWorkRecord[]>;
  showPosts: boolean;
  showAgentWork: boolean;
}) {
  const dates =
    view === "week"
      ? Array.from({ length: 7 }, (_, index) =>
          addDays(startOfWeek(selected), index),
        )
      : [selected];
  const timelineHeight =
    (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * TIMELINE_ROW_HEIGHT;
  const hours = Array.from(
    { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
    (_, index) => TIMELINE_START_HOUR + index,
  );

  const eventTop = (timestamp: number) => {
    const date = new Date(timestamp);
    const elapsedMinutes =
      date.getHours() * 60 + date.getMinutes() - TIMELINE_START_HOUR * 60;
    return Math.max(
      5,
      Math.min(
        timelineHeight - 47,
        (elapsedMinutes / 60) * TIMELINE_ROW_HEIGHT,
      ),
    );
  };

  return (
    <div className="h-full min-w-0 touch-pan-y [scrollbar-width:thin] [scrollbar-gutter:stable] overflow-y-scroll overscroll-contain">
      <div className="bg-card/90 sticky top-0 z-30 backdrop-blur-xl">
        <div
          className="grid border-b border-black/[0.055] dark:border-white/[0.055]"
          style={{
            gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))`,
          }}
        >
          <div />
          {dates.map((date) => {
            const isToday = dayKey(date) === dayKey(today);
            const isSelected = dayKey(date) === dayKey(selected);
            return (
              <button
                key={dayKey(date)}
                type="button"
                onClick={() => onSelect(date)}
                className="hover:bg-accent/25 flex min-w-0 items-center justify-center gap-2 border-l border-black/[0.055] px-2 py-2.5 transition-colors dark:border-white/[0.055]"
              >
                <span className="text-muted-foreground truncate text-[11px] font-medium">
                  {date.toLocaleDateString([], { weekday: "short" })}
                </span>
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-xs font-semibold",
                    isToday && "bg-foreground text-background",
                    isSelected && !isToday && "bg-accent",
                  )}
                >
                  {date.getDate()}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="grid min-h-14 border-b border-black/[0.055] dark:border-white/[0.055]"
          style={{
            gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))`,
          }}
        >
          <div className="text-muted-foreground px-2 pt-2.5 text-right text-[9px]">
            Unscheduled
          </div>
          {dates.map((date) => {
            const unscheduled = showPosts
              ? (byDay.get(dayKey(date)) ?? []).filter(
                  (draft) => draft.scheduledFor === undefined,
                )
              : [];
            return (
              <div
                key={dayKey(date)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onDateContext(date, event.clientX, event.clientY);
                }}
                className="min-w-0 border-l border-black/[0.055] p-1.5 dark:border-white/[0.055]"
              >
                {unscheduled.slice(0, 1).map((draft) => (
                  <DraftChip
                    key={draft.id}
                    draft={draft}
                    onOpen={onDraftOpen}
                  />
                ))}
                {unscheduled.length > 1 ? (
                  <p className="text-muted-foreground px-2 py-1 text-[9px]">
                    +{unscheduled.length - 1} awaiting a time
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative" style={{ height: timelineHeight }}>
        {hours.map((hour, index) => (
          <div
            key={hour}
            className="absolute right-0 left-0 flex items-start"
            style={{ top: index * TIMELINE_ROW_HEIGHT }}
          >
            <span
              className={cn(
                "text-muted-foreground pr-2 text-right text-[9px] tabular-nums",
                index > 0 && "-translate-y-1.5",
              )}
              style={{ width: 64 }}
            >
              {new Date(2000, 0, 1, hour).toLocaleTimeString([], {
                hour: "numeric",
              })}
            </span>
            <span className="h-px flex-1 bg-black/[0.055] dark:bg-white/[0.055]" />
          </div>
        ))}

        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `64px repeat(${dates.length}, minmax(0, 1fr))`,
          }}
        >
          <div />
          {dates.map((date) => {
            const key = dayKey(date);
            const drafts = showPosts
              ? (byDay.get(key) ?? []).filter(
                  (draft): draft is ScheduledDraft & { scheduledFor: number } =>
                    draft.scheduledFor !== undefined,
                )
              : [];
            const recurring = showAgentWork
              ? (recurringByDay.get(key) ?? []).flatMap((work) => {
                  const timestamp = work.upcomingRuns?.find(
                    (run) => dayKey(new Date(run)) === key,
                  );
                  return timestamp === undefined ? [] : [{ work, timestamp }];
                })
              : [];
            return (
              <div
                key={key}
                onClick={() => onSelect(date)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onDateContext(date, event.clientX, event.clientY);
                }}
                className={cn(
                  "relative min-w-0 border-l border-black/[0.055] dark:border-white/[0.055]",
                  key === dayKey(selected) && "bg-foreground/[0.012]",
                )}
              >
                {recurring.map(({ work, timestamp }) => (
                  <button
                    key={`${work.id}-${timestamp}`}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onWorkOpen(work);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onWorkContext(work, date, event.clientX, event.clientY);
                    }}
                    className={cn(
                      "absolute right-1.5 left-1.5 overflow-hidden rounded-[10px] px-2.5 py-2 text-left transition-colors",
                      agentWorkTone(work.agentId, timestamp < now),
                    )}
                    style={{ top: eventTop(timestamp), minHeight: 42 }}
                  >
                    <WorkEventContent
                      work={work}
                      time={new Date(timestamp).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      muted={timestamp < now}
                    />
                  </button>
                ))}
                {drafts.map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDraftOpen(draft);
                    }}
                    className={cn(
                      "absolute right-1.5 left-1.5 overflow-hidden rounded-[10px] px-2.5 py-2 text-left transition-colors",
                      draftTone(draft.status, draft.scheduledFor < now),
                    )}
                    style={{
                      top: eventTop(draft.scheduledFor),
                      minHeight: 42,
                    }}
                  >
                    <DraftEventContent
                      draft={draft}
                      time={new Date(draft.scheduledFor).toLocaleTimeString(
                        [],
                        {
                          hour: "numeric",
                          minute: "2-digit",
                        },
                      )}
                      muted={draft.scheduledFor < now}
                    />
                  </button>
                ))}
              </div>
            );
          })}
        </div>
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
  const actions: {
    id: DateMenuAction;
    label: string;
    detail: string;
    Icon: typeof CalendarPlus;
  }[] = [
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
      className="bg-popover/95 text-popover-foreground fixed z-50 w-64 rounded-xl p-1.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent),0_16px_48px_rgba(0,0,0,0.14)] backdrop-blur-xl"
      style={{
        left: Math.min(context.x, window.innerWidth - 272),
        top: Math.min(context.y, window.innerHeight - 238),
      }}
    >
      <p className="text-muted-foreground px-2 py-1.5 text-[10px]">
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
          className="hover:bg-accent flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors"
        >
          <Icon size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-xs font-medium">{label}</span>
            <span className="text-muted-foreground mt-0.5 block text-[10px]">
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
      className="bg-popover/95 text-popover-foreground fixed z-50 w-64 rounded-xl p-1.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent),0_16px_48px_rgba(0,0,0,0.14)] backdrop-blur-xl"
      style={{
        left: Math.min(context.x, window.innerWidth - 272),
        top: Math.min(context.y, window.innerHeight - 190),
      }}
    >
      <p className="text-muted-foreground truncate px-2 py-1.5 text-[10px]">
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
          className="hover:bg-accent flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors"
        >
          <Pause size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="block text-xs font-medium">
              Skip this occurrence
            </span>
            <span className="text-muted-foreground mt-0.5 block text-[10px]">
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
        className="hover:bg-accent flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors"
      >
        <Pencil size={14} className="mt-0.5 shrink-0" />
        <span>
          <span className="block text-xs font-medium">Edit schedule</span>
          <span className="text-muted-foreground mt-0.5 block text-[10px]">
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
        className="hover:bg-accent flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors"
      >
        <Trash2 size={14} className="text-destructive mt-0.5 shrink-0" />
        <span>
          <span className="text-destructive block text-xs font-medium">
            Cancel series
          </span>
          <span className="text-muted-foreground mt-0.5 block text-[10px]">
            Removes the automation and upcoming occurrences
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

function friendlySchedule(work: RecurringWorkRecord) {
  if (work.onceAt !== undefined) {
    return new Date(work.onceAt).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const fields = fieldsFromCron(work.cron);
  if (fields.frequency === "custom") return work.cron;
  const time = new Date(`2000-01-01T${fields.time}:00`).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (fields.frequency === "daily") return `Every day at ${time}`;
  if (fields.frequency === "weekdays") return `Weekdays at ${time}`;
  if (fields.frequency === "weekly") {
    const weekday = WEEKDAY_OPTIONS.find(
      (option) => option.value === fields.weekday,
    )?.label;
    return `Every ${weekday ?? "week"} at ${time}`;
  }
  return `Monthly on day ${fields.dayOfMonth} at ${time}`;
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
    // This form remains mounted behind the dialog and resets when its record changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const frequencies: { value: ScheduleFrequency; label: string }[] = [
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
                Change the timing directly, or ask for a change in the approval
                card and the agent will rework it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs">Title</label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs">Repeats</label>
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
                    <p className="text-muted-foreground text-[10px]">
                      minute · hour · day of month · month · day of week
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground font-mono text-[10px]">
                    {cron}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-muted-foreground text-xs">
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
  now,
  onClose,
  onApprove,
  onReject,
  revision,
}: {
  work: RecurringWorkRecord | null;
  now: number;
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
  const missedOneOff = Boolean(
    work?.onceAt !== undefined && work.onceAt <= now,
  );
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
                {work.onceAt === undefined
                  ? "Approve recurring work"
                  : "Approve task"}
              </DialogTitle>
              <DialogDescription>
                {missedOneOff
                  ? "Its scheduled time has passed. Approving will run it now."
                  : work.onceAt === undefined
                    ? `Approve this once and ${work.agentId} will keep running it until you pause or revoke it.`
                    : `Approve this once and ${work.agentId} will run it at the scheduled time.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="border p-4">
                <p className="text-sm font-medium">{work.title}</p>
                <p className="text-muted-foreground mt-2 text-sm leading-6">
                  {work.approvalSummary}
                </p>
                <p className="text-muted-foreground mt-3 font-mono text-[11px]">
                  {work.onceAt === undefined
                    ? work.cron
                    : new Date(work.onceAt).toLocaleString()}{" "}
                  · {work.timezone}
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
                        <span className="text-muted-foreground ml-auto max-w-56 truncate font-mono text-[9px]">
                          {pattern}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground border px-3 py-2 text-xs">
                      Read connected data and save no external changes.
                    </p>
                  )}
                </div>
              </div>
              <p className="text-muted-foreground text-xs leading-5">
                New integration actions are blocked automatically. Chief will
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
                    <AgentWorkingIndicator className="mt-2" />
                  ) : revision.note ? (
                    <p className="text-muted-foreground mt-2 text-xs leading-5">
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
                className="text-muted-foreground hover:text-destructive mr-auto text-xs transition-colors"
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
                {missedOneOff ? "Approve and run now" : "Approve and activate"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleEventDetailDialog({
  work,
  draft,
  onClose,
  onEditWork,
  onOpenDraft,
}: {
  work: RecurringWorkRecord | null;
  draft: ScheduledDraft | null;
  onClose: () => void;
  onEditWork: (work: RecurringWorkRecord) => void;
  onOpenDraft: (draft: ScheduledDraft) => void;
}) {
  const open = Boolean(work ?? draft);
  const source = work ? agentName(work.agentId) : draft?.platform;
  const status = work
    ? workStatusLabel(work.status)
    : draft
      ? draft.status[0]?.toUpperCase() + draft.status.slice(1)
      : "";
  const timing = work
    ? friendlySchedule(work)
    : draft?.scheduledFor
      ? new Date(draft.scheduledFor).toLocaleString([], {
          weekday: "long",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Awaiting a time";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        {work || draft ? (
          <>
            <DialogHeader className="px-6 pt-6 pb-4 text-left">
              <div className="flex items-start gap-3.5 pr-8">
                <span className="bg-foreground/[0.06] flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
                  {source?.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 pt-0.5">
                  <DialogTitle className="text-lg leading-6 font-semibold tracking-[-0.02em]">
                    {work?.title ?? draft?.title}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-xs">
                    {source} · {timing}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 px-6 pb-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-foreground/[0.035] rounded-xl px-3 py-2.5">
                  <p className="text-muted-foreground text-[10px]">Status</p>
                  <p className="mt-0.5 text-xs font-medium">{status}</p>
                </div>
                <div className="bg-foreground/[0.035] rounded-xl px-3 py-2.5">
                  <p className="text-muted-foreground text-[10px]">
                    {work ? "Runs" : "Destination"}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-medium">
                    {work ? friendlySchedule(work) : draft?.platform}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-muted-foreground mb-1.5 text-[10px]">
                  {work ? "Brief" : "Content"}
                </p>
                <div className="bg-foreground/[0.025] max-h-56 overflow-y-auto rounded-xl px-3.5 py-3 text-xs leading-5 whitespace-pre-wrap shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
                  {work
                    ? work.instructions.length > 0
                      ? work.instructions
                      : "No additional instructions."
                    : draft && draft.body.length > 0
                      ? draft.body
                      : "No draft content yet."}
                </div>
              </div>
            </div>

            <DialogFooter className="bg-foreground/[0.018] border-t border-black/[0.055] px-6 py-4 dark:border-white/[0.055]">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {work ? (
                <Button onClick={() => onEditWork(work)}>Edit schedule</Button>
              ) : draft?.fileId ? (
                <Button onClick={() => onOpenDraft(draft)}>Open draft</Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MonthJump({
  month,
  onSelect,
}: {
  month: Date;
  onSelect: (month: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(month.getFullYear());

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setYear(month.getFullYear());
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hover:bg-accent/45 group flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-xl font-semibold tracking-[-0.025em] transition-colors"
        >
          <span className="truncate">{monthLabel(month)}</span>
          <ChevronDown
            size={14}
            className="text-muted-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 rounded-2xl p-2.5">
        <div className="mb-2 flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => setYear((value) => value - 1)}
            className="hover:bg-accent flex size-7 items-center justify-center rounded-lg transition-colors"
            aria-label="Previous year"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-semibold tabular-nums">{year}</span>
          <button
            type="button"
            onClick={() => setYear((value) => value + 1)}
            className="hover:bg-accent flex size-7 items-center justify-center rounded-lg transition-colors"
            aria-label="Next year"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, index) => {
            const candidate = new Date(year, index, 1);
            const active = sameMonth(candidate, month);
            return (
              <button
                key={index}
                type="button"
                onClick={() => {
                  onSelect(candidate);
                  setOpen(false);
                }}
                className={cn(
                  "hover:bg-accent rounded-lg px-2 py-2 text-xs transition-colors",
                  active && "bg-foreground text-background hover:bg-foreground",
                )}
              >
                {candidate.toLocaleDateString([], { month: "short" })}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ScheduleInbox({
  work,
  onOpen,
}: {
  work: RecurringWorkRecord[];
  onOpen: (work: RecurringWorkRecord) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Inbox size={13} />
          Review
          {work.length > 0 ? (
            <span className="ml-0.5 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 tabular-nums dark:text-amber-300">
              {work.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl p-2">
        <div className="px-2 pt-1 pb-2">
          <p className="text-xs font-semibold">Schedule inbox</p>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            Agent work waiting for your judgment.
          </p>
        </div>
        {work.length > 0 ? (
          <div className="space-y-1">
            {work.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item)}
                className="hover:bg-accent flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-amber-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block truncate text-[10px]">
                    {agentName(item.agentId)} · {friendlySchedule(item)}
                  </span>
                </span>
                <ChevronRight
                  size={12}
                  className="text-muted-foreground shrink-0"
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground rounded-xl bg-emerald-500/[0.05] px-3 py-3 text-[10px] shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]">
            Nothing is waiting for review.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function SchedulePage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const today = useMemo(() => startOfDay(new Date()), []);
  const [now, setNow] = useState(Date.now);
  const currentMonth = useMemo(() => startOfMonth(today), [today]);
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<CalendarView>("week");
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
  const [detailWorkId, setDetailWorkId] = useState<string | null>(null);
  const [detailDraftId, setDetailDraftId] = useState<string | null>(null);
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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // Derived from live workspace data so an agent revision streams straight
  // into the open approval card.
  const approvalWork = approvalWorkId
    ? (workspaceData.recurringWork.find((work) => work.id === approvalWorkId) ??
      null)
    : null;
  const detailWork = detailWorkId
    ? (workspaceData.recurringWork.find((work) => work.id === detailWorkId) ??
      null)
    : null;
  const detailDraft = detailDraftId
    ? (workspaceData.drafts.find((draft) => draft.id === detailDraftId) ?? null)
    : null;
  const revisionDriver = agentConfig.forAgent("cmo").driver;
  const revisionChat = useChiefChat(approvalWork?.conversationId ?? null);
  const revisionNote = useMemo(() => {
    for (let i = revisionChat.messages.length - 1; i >= 0; i -= 1) {
      const item = revisionChat.messages[i]!;
      if (item.role !== "assistant") continue;
      const text = messageBlocks(item)
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(" ")
        .trim();
      if (text) return text;
    }
    return null;
  }, [revisionChat.messages]);
  const openWorkReview = (work: RecurringWorkRecord) => {
    if (work.status === "draft" || work.status === "needs_approval") {
      setApprovalWorkId(work.id);
      return;
    }
    setDetailWorkId(work.id);
  };

  const requestRevision = (feedback: string) => {
    if (!approvalWork) return;
    const draft = {
      id: approvalWork.id,
      agentId: approvalWork.agentId,
      title: approvalWork.title,
      cron: approvalWork.cron,
      timezone: approvalWork.timezone,
      onceAt: approvalWork.onceAt,
      instructions: approvalWork.instructions,
      approvalSummary: approvalWork.approvalSummary,
      proposedToolPatterns: approvalWork.proposedToolPatterns,
    };
    void revisionChat.sendMessage({
      text: [
        "The user is reviewing a draft recurring-work approval and asked for a change before approving.",
        `Current draft (JSON): ${JSON.stringify(draft)}`,
        `Feedback: "${feedback}"`,
        `Right now it is ${new Date().toString()}.`,
        "Apply the feedback by calling the recurringWorkPropose local tool with the SAME id and ALL fields (id, title, agentId, cron, timezone, onceAt when present, instructions, approvalSummary, proposedToolPatterns), changing only what the feedback requires. Then reply with one short sentence stating exactly what changed. Do not ask questions.",
      ].join("\n"),
    });
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
      // Drafts are review work even before a publishing time is chosen. Put
      // them on the day they were prepared, then move them to the scheduled
      // date once the user approves a concrete slot.
      const calendarTime = draft.scheduledFor ?? draft.createdAt;
      const key = dayKey(new Date(calendarTime));
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

  const showPosts = visibleKinds.has("post");
  const showAgentWork = visibleKinds.has("agent-work");
  const pendingApprovals = workspaceData.recurringWork.filter(
    (work) => work.status === "draft" || work.status === "needs_approval",
  );
  const activeScheduleCount = workspaceData.recurringWork.filter(
    (work) => work.status === "active",
  ).length;

  const requestMonth = (month: Date) => {
    setMonthDirection(month > activeMonth ? 1 : -1);
    setScrollRequest((current) => ({ month, token: current.token + 1 }));
    setActiveMonth(month);
  };

  const openChiefForDate = (
    specialist: string,
    title: string,
    text: string,
    send = false,
  ) => {
    const chat = createChat(title);
    const prompt = `Consult the ${specialist} specialist. ${text}`;
    void navigate(
      `/conversations?chat=${chat.id}&${send ? "prompt" : "draft"}=${encodeURIComponent(prompt)}`,
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
      openChiefForDate(
        "Content Writer",
        `Content for ${dateText}`,
        `Draft and schedule a piece of content for ${dateText}.`,
      );
      return;
    }
    if (action === "recurring") {
      const chat = createChat("Set up recurring work");
      void navigate(`/conversations?chat=${chat.id}&compose=recurring`);
      return;
    }
    if (action === "event") {
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const chat = createChat(`Event on ${dateText}`);
      void navigate(
        `/conversations?chat=${chat.id}&compose=oneoff&date=${iso}`,
      );
      return;
    }
    openChiefForDate(
      "appropriate marketing",
      `Plan ${dateText}`,
      `Help me plan the marketing work and content for ${dateText}.`,
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
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-6 pt-5 pb-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.035em]">
            Schedule
          </h1>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Direct when agents work and review what they have planned.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const chat = createChat("Set up recurring work");
              void navigate(`/conversations?chat=${chat.id}&compose=recurring`);
            }}
          >
            <Plus size={13} />
            New agent work
          </Button>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 shrink-0 items-center justify-between gap-4 border-b border-black/[0.055] px-6 pb-3 dark:border-white/[0.055]">
          <div className="relative h-8 min-w-0 flex-1 overflow-hidden">
            {view === "month" ? (
              <MonthJump month={activeMonth} onSelect={requestMonth} />
            ) : (
              <AnimatePresence
                initial={false}
                mode="popLayout"
                custom={monthDirection}
              >
                <motion.p
                  key={focusedHeading}
                  initial={
                    reduceMotion
                      ? false
                      : { y: monthDirection * 18, opacity: 0 }
                  }
                  animate={{ y: 0, opacity: 1 }}
                  exit={
                    reduceMotion
                      ? { opacity: 0 }
                      : { y: monthDirection * -18, opacity: 0 }
                  }
                  transition={{
                    type: "spring",
                    stiffness: 440,
                    damping: 38,
                    mass: 0.7,
                  }}
                  className="absolute inset-x-0 min-w-0 truncate text-xl font-semibold tracking-[-0.025em]"
                >
                  {focusedHeading}
                </motion.p>
              </AnimatePresence>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ScheduleInbox work={pendingApprovals} onOpen={openWorkReview} />
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
            <Button variant="outline" size="icon-sm" onClick={() => move(-1)}>
              <ChevronLeft size={14} />
            </Button>
            <Button variant="outline" size="icon-sm" onClick={() => move(1)}>
              <ChevronRight size={14} />
            </Button>
            <div className="bg-muted/45 flex rounded-lg p-0.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
              {(["month", "week", "day"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  className={cn(
                    "text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-[11px] font-medium capitalize transition-[background-color,box-shadow,color]",
                    view === option &&
                      "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.07),inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-background min-h-0 min-w-0 flex-1 overflow-hidden border-b border-black/[0.055] dark:border-white/[0.055]">
          {view === "month" ? (
            <ContinuousMonthView
              currentMonth={currentMonth}
              activeMonth={activeMonth}
              onActiveMonthChange={(month) => {
                setMonthDirection(month > activeMonth ? 1 : -1);
                setActiveMonth(month);
              }}
              today={today}
              now={now}
              selected={selected}
              onSelect={setSelected}
              onWorkOpen={openWorkReview}
              onDraftOpen={(draft) => setDetailDraftId(draft.id)}
              onWorkContext={(work, date, x, y) =>
                setWorkMenu({ work, date, x, y })
              }
              onDateContext={(date, x, y) => {
                setSelected(date);
                setDateMenu({ date, x, y });
              }}
              byDay={byDay}
              recurringByDay={recurringByDay}
              showPosts={showPosts}
              showAgentWork={showAgentWork}
              scrollRequest={scrollRequest}
            />
          ) : (
            <FocusedCalendarView
              view={view}
              selected={selected}
              today={today}
              now={now}
              onSelect={setSelected}
              onWorkOpen={openWorkReview}
              onDraftOpen={(draft) => setDetailDraftId(draft.id)}
              onWorkContext={(work, date, x, y) =>
                setWorkMenu({ work, date, x, y })
              }
              onDateContext={(date, x, y) => {
                setSelected(date);
                setDateMenu({ date, x, y });
              }}
              byDay={byDay}
              recurringByDay={recurringByDay}
              showPosts={showPosts}
              showAgentWork={showAgentWork}
            />
          )}
        </div>
        <footer className="text-muted-foreground flex h-11 shrink-0 items-center justify-between px-6 text-[10px]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-amber-400" />
              Prospecting
            </span>
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-sky-500" />
              Analytics
            </span>
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-rose-400" />
              Content
            </span>
          </div>
          <span className="flex items-center gap-2 tabular-nums">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {activeScheduleCount} active schedules
          </span>
        </footer>
      </section>
      <RecurringWorkApprovalDialog
        work={approvalWork}
        now={now}
        onClose={() => setApprovalWorkId(null)}
        onApprove={(work) => {
          workspaceData.saveRecurringWork({
            ...work,
            status: "active",
            grant: {
              version: 1,
              approvedAt: Date.now(),
              toolPatterns: work.proposedToolPatterns,
            },
            updatedAt: Date.now(),
          });
          const actionItem = workspaceData.actionItems.find(
            (item) => item.id === `action-${work.id}-approval`,
          );
          if (actionItem) workspaceData.dismissActionItem(actionItem.id);
        }}
        onReject={(work) => {
          workspaceData.deleteRecurringWork(work.id);
          const actionItem = workspaceData.actionItems.find(
            (item) => item.id === `action-${work.id}-approval`,
          );
          if (actionItem) workspaceData.dismissActionItem(actionItem.id);
        }}
        revision={{
          available: Boolean(revisionDriver),
          busy:
            !revisionChat.chatReady ||
            revisionChat.controls.status === "running",
          note: revisionNote,
          onRequest: requestRevision,
        }}
      />
      <ScheduleEventDetailDialog
        work={detailWork}
        draft={detailDraft}
        onClose={() => {
          setDetailWorkId(null);
          setDetailDraftId(null);
        }}
        onEditWork={(work) => {
          setDetailWorkId(null);
          setEditWorkId(work.id);
        }}
        onOpenDraft={(draft) => {
          setDetailDraftId(null);
          if (draft.fileId) {
            void navigate(`/files/${encodeURIComponent(draft.fileId)}`);
          }
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
