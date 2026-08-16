/* eslint-disable max-lines */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Pause,
  Pencil,
  Repeat2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
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

import type {
  CalendarView,
  ScheduledDraft,
  ScheduleKind,
} from "./schedule-calendar-core";
import { AgentWorkingIndicator } from "../components/chat/agent-working-indicator";
import { PageTitle } from "../components/page-title";
import { useAgentConfig } from "../lib/agent-config";
import { useAuth } from "../lib/auth/auth-context";
import { messageBlocks, useChiefChat, useWorkspaceData } from "../lib/runtime";
import {
  addDays,
  addMonths,
  agentName,
  buildMonthCells,
  CALENDAR_HEADER_HEIGHT,
  dayKey,
  DraftEventContent,
  eventSurface,
  monthKey,
  monthLabel,
  MONTHS_AFTER,
  MONTHS_BEFORE,
  sameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  TIMELINE_END_HOUR,
  TIMELINE_ROW_HEIGHT,
  TIMELINE_START_HOUR,
  WEEKDAYS,
  WorkEventContent,
  workStatusLabel,
} from "./schedule-calendar-core";

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
        "block min-h-11 w-full min-w-0 overflow-hidden rounded-[10px] px-2.5 py-2 text-left transition-colors select-none",
        eventSurface(past),
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
        "min-h-11 min-w-0 overflow-hidden rounded-[10px] px-2.5 py-2 transition-colors select-none",
        eventSurface(past),
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
  const programmaticMonth = useRef<string | null>(null);
  const scrollEndTimer = useRef<number | null>(null);

  const scrollToMonth = (month: Date, behavior: ScrollBehavior) => {
    const container = calendarRef.current;
    const key = monthKey(month);
    const section = monthSections.current.get(key);
    if (!container || !section) return;
    programmaticMonth.current = behavior === "smooth" ? key : null;
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
      if (scrollEndTimer.current !== null) {
        window.clearTimeout(scrollEndTimer.current);
      }
    },
    [],
  );

  const syncActiveMonthFromScroll = () => {
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
  };

  const handleScroll = () => {
    if (scrollEndTimer.current !== null) {
      window.clearTimeout(scrollEndTimer.current);
    }
    scrollEndTimer.current = window.setTimeout(() => {
      programmaticMonth.current = null;
      scrollEndTimer.current = null;
      syncActiveMonthFromScroll();
    }, 120);
    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (programmaticMonth.current !== null) return;
      syncActiveMonthFromScroll();
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
                "hover:text-muted-foreground absolute top-2.5 left-3 z-10 text-left text-lg font-medium tracking-[-0.025em] transition-[color,opacity] duration-200",
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

const TIMELINE_EVENT_HEIGHT = 44;
const TIMELINE_EVENT_GAP = 3;

type TimelineEvent =
  | {
      id: string;
      kind: "work";
      timestamp: number;
      work: RecurringWorkRecord;
    }
  | {
      id: string;
      kind: "draft";
      timestamp: number;
      draft: ScheduledDraft;
    };

type PositionedTimelineEvent = TimelineEvent & {
  lane: number;
  laneCount: number;
  top: number;
};

function timelineEventTop(timestamp: number, timelineHeight: number) {
  const date = new Date(timestamp);
  const elapsedMinutes =
    date.getHours() * 60 + date.getMinutes() - TIMELINE_START_HOUR * 60;
  return Math.max(
    5,
    Math.min(
      timelineHeight - TIMELINE_EVENT_HEIGHT - 5,
      (elapsedMinutes / 60) * TIMELINE_ROW_HEIGHT,
    ),
  );
}

function layoutTimelineEvents(
  events: TimelineEvent[],
  timelineHeight: number,
): PositionedTimelineEvent[] {
  const positioned = events
    .map((event) => ({
      ...event,
      lane: 0,
      laneCount: 1,
      top: timelineEventTop(event.timestamp, timelineHeight),
    }))
    .sort(
      (left, right) => left.top - right.top || left.id.localeCompare(right.id),
    );

  let clusterStart = 0;
  let clusterEnd = Number.NEGATIVE_INFINITY;
  let laneEnds: number[] = [];

  const finishCluster = (end: number) => {
    const laneCount = Math.max(1, laneEnds.length);
    for (let index = clusterStart; index < end; index += 1) {
      const event = positioned[index];
      if (event) event.laneCount = laneCount;
    }
  };

  for (let index = 0; index < positioned.length; index += 1) {
    const event = positioned[index];
    if (!event) continue;
    if (index > clusterStart && event.top >= clusterEnd) {
      finishCluster(index);
      clusterStart = index;
      clusterEnd = Number.NEGATIVE_INFINITY;
      laneEnds = [];
    }

    const availableLane = laneEnds.findIndex((end) => end <= event.top);
    event.lane = availableLane === -1 ? laneEnds.length : availableLane;
    const eventEnd = event.top + TIMELINE_EVENT_HEIGHT + TIMELINE_EVENT_GAP;
    laneEnds[event.lane] = eventEnd;
    clusterEnd = Math.max(clusterEnd, eventEnd);
  }

  finishCluster(positioned.length);
  return positioned;
}

function FocusedCalendarView({
  view,
  selected,
  today,
  now,
  onSelect,
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

  return (
    <div className="h-full min-w-0 touch-pan-y [scrollbar-width:thin] [scrollbar-gutter:stable] overflow-y-scroll overscroll-contain">
      <div className="bg-card/92 sticky top-0 z-30 backdrop-blur-xl">
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
                "text-muted-foreground pr-2 text-right text-[12px] leading-4 font-normal tabular-nums",
                index > 0 && "-translate-y-2",
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
            const events = layoutTimelineEvents(
              [
                ...recurring.map(({ work, timestamp }) => ({
                  id: `${work.id}-${timestamp}`,
                  kind: "work" as const,
                  timestamp,
                  work,
                })),
                ...drafts.map((draft) => ({
                  id: draft.id,
                  kind: "draft" as const,
                  timestamp: draft.scheduledFor,
                  draft,
                })),
              ],
              timelineHeight,
            );
            return (
              <div
                key={key}
                onClick={() => onSelect(date)}
                className={cn(
                  "relative min-w-0 border-l border-black/[0.055] dark:border-white/[0.055]",
                  key === dayKey(selected) && "bg-foreground/[0.012]",
                )}
              >
                {events.map((event) => {
                  const firstLane = event.lane === 0;
                  const lastLane = event.lane === event.laneCount - 1;
                  const positionedStyle = {
                    top: event.top,
                    minHeight: TIMELINE_EVENT_HEIGHT,
                    left: `calc(${(event.lane * 100) / event.laneCount}% + ${firstLane ? 6 : 2}px)`,
                    right: `calc(${((event.laneCount - event.lane - 1) * 100) / event.laneCount}% + ${lastLane ? 6 : 2}px)`,
                  };

                  if (event.kind === "work") {
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          onWorkOpen(event.work);
                        }}
                        onContextMenu={(contextEvent) => {
                          contextEvent.preventDefault();
                          contextEvent.stopPropagation();
                          onWorkContext(
                            event.work,
                            date,
                            contextEvent.clientX,
                            contextEvent.clientY,
                          );
                        }}
                        className={cn(
                          "absolute z-10 overflow-hidden rounded-[9px] px-2.5 py-2 text-left transition-[background-color,box-shadow,filter]",
                          eventSurface(event.timestamp < now),
                        )}
                        style={positionedStyle}
                      >
                        <WorkEventContent
                          work={event.work}
                          time={new Date(event.timestamp).toLocaleTimeString(
                            [],
                            { hour: "numeric", minute: "2-digit" },
                          )}
                          muted={event.timestamp < now}
                        />
                      </button>
                    );
                  }

                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        onDraftOpen(event.draft);
                      }}
                      className={cn(
                        "absolute z-10 overflow-hidden rounded-[9px] px-2.5 py-2 text-left transition-[background-color,box-shadow,filter]",
                        eventSurface(event.timestamp < now),
                      )}
                      style={positionedStyle}
                    >
                      <DraftEventContent
                        draft={event.draft}
                        time={new Date(event.timestamp).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        muted={event.timestamp < now}
                      />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
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
  if (fields.frequency === "custom") return "Custom schedule";
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

function friendlyTimezone(timezone: string) {
  if (timezone === Intl.DateTimeFormat().resolvedOptions().timeZone) {
    return "your time";
  }
  const location = timezone.split("/").at(-1)?.replaceAll("_", " ");
  return `${location ?? timezone} time`;
}

function approvalTiming(work: RecurringWorkRecord) {
  const timing = friendlySchedule(work);
  return work.onceAt === undefined
    ? `${timing} · ${friendlyTimezone(work.timezone)}`
    : timing;
}

function conciseApprovalSummary(work: RecurringWorkRecord) {
  const summary = work.approvalSummary.replace(/\s+/g, " ").trim();
  if (
    !summary ||
    summary.toLocaleLowerCase() === work.title.toLocaleLowerCase()
  ) {
    return null;
  }
  if (summary.length <= 260) return summary;
  const shortened = summary.slice(0, 257);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > 180 ? lastSpace : 257)}…`;
}

function friendlyPermission(pattern: string) {
  const action = pattern.split(".").at(-1) ?? pattern;
  const words = action
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words
    ? words.charAt(0).toLocaleUpperCase() + words.slice(1)
    : "Use connected data";
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
              <DialogTitle className="text-2xl font-normal">
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
  const [showFeedback, setShowFeedback] = useState(false);
  const missedOneOff = Boolean(
    work?.onceAt !== undefined && work.onceAt <= now,
  );
  const summary = work ? conciseApprovalSummary(work) : null;
  const permissions = work
    ? [...new Set(work.proposedToolPatterns.map(friendlyPermission))]
    : [];
  const closeDialog = () => {
    setFeedback("");
    setShowFeedback(false);
    onClose();
  };
  const submitFeedback = () => {
    const text = feedback.trim();
    if (!text || revision.busy) return;
    setFeedback("");
    revision.onRequest(text);
  };
  return (
    <Dialog
      open={Boolean(work)}
      onOpenChange={(open) => !open && closeDialog()}
    >
      <DialogContent className="max-w-md overflow-hidden p-0">
        {work ? (
          <>
            <DialogHeader className="px-6 pt-6 pb-4 text-left">
              <div className="flex items-start gap-3.5 pr-8">
                <span className="bg-foreground text-background flex size-10 shrink-0 items-center justify-center rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                  {work.onceAt === undefined ? (
                    <Repeat2 size={17} />
                  ) : (
                    <CalendarPlus size={17} />
                  )}
                </span>
                <div className="min-w-0 pt-0.5">
                  <DialogTitle className="text-xl leading-6 font-semibold tracking-[-0.02em]">
                    {work.onceAt === undefined
                      ? "Approve this schedule?"
                      : "Approve this task?"}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-xs leading-5">
                    {missedOneOff
                      ? "Its planned time has passed, so approval will run it now."
                      : work.onceAt === undefined
                        ? "Chief will handle this automatically until you pause or remove it."
                        : "Chief will handle this once at the planned time."}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-3 px-6 pb-6">
              <div className="bg-foreground/[0.035] rounded-2xl p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
                <p className="text-[15px] leading-5 font-semibold tracking-[-0.015em]">
                  {work.title}
                </p>
                {summary ? (
                  <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                    {summary}
                  </p>
                ) : null}
                <dl className="mt-4 grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-black/[0.055] pt-3 text-xs dark:border-white/[0.055]">
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="font-medium">{approvalTiming(work)}</dd>
                  <dt className="text-muted-foreground">Owner</dt>
                  <dd className="font-medium">{agentName(work.agentId)}</dd>
                </dl>
              </div>

              <div className="flex items-start gap-2.5 px-1 py-1">
                <ShieldCheck
                  size={15}
                  className="mt-0.5 shrink-0 text-emerald-500"
                />
                <p className="text-muted-foreground text-[11px] leading-4.5">
                  Chief cannot add new permissions without asking you again.
                </p>
              </div>

              {permissions.length > 0 ? (
                <details className="group rounded-xl border border-black/[0.055] px-3 py-2.5 dark:border-white/[0.055]">
                  <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center justify-between text-[11px] transition-colors marker:content-none">
                    <span>What it can access</span>
                    <span className="tabular-nums">
                      {permissions.length}{" "}
                      {permissions.length === 1 ? "action" : "actions"}
                    </span>
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-black/[0.055] pt-2.5 dark:border-white/[0.055]">
                    {permissions.slice(0, 4).map((permission) => (
                      <span
                        key={permission}
                        className="bg-foreground/[0.045] rounded-md px-2 py-1 text-[10px]"
                      >
                        {permission}
                      </span>
                    ))}
                    {permissions.length > 4 ? (
                      <span className="text-muted-foreground px-1 py-1 text-[10px]">
                        +{permissions.length - 4} more
                      </span>
                    ) : null}
                  </div>
                </details>
              ) : null}

              {revision.available && !showFeedback ? (
                <button
                  type="button"
                  onClick={() => setShowFeedback(true)}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-1 py-1 text-[11px] font-medium transition-colors"
                >
                  <Pencil size={12} />
                  Ask Chief to change something
                </button>
              ) : null}

              {revision.available && showFeedback ? (
                <div className="bg-foreground/[0.025] rounded-xl p-3 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
                  <p className="mb-2 text-xs font-medium">
                    What should Chief change?
                  </p>
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
                      placeholder="For example, move it to Friday morning"
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
                      Ask
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
            <DialogFooter className="bg-foreground/[0.018] items-center border-t border-black/[0.055] px-6 py-4 dark:border-white/[0.055]">
              <button
                type="button"
                onClick={() => {
                  onReject(work);
                  closeDialog();
                }}
                className="text-muted-foreground hover:text-destructive mr-auto text-xs transition-colors"
              >
                Delete request
              </button>
              <Button
                disabled={revision.busy}
                onClick={() => {
                  onApprove(work);
                  closeDialog();
                }}
              >
                {missedOneOff
                  ? "Approve and run now"
                  : work.onceAt === undefined
                    ? "Approve schedule"
                    : "Approve task"}
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
          className="hover:bg-accent/45 group flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-xl font-medium tracking-[-0.025em] transition-colors"
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
        <Button
          variant={work.length > 0 ? "default" : "outline"}
          size="sm"
          className={cn(work.length > 0 && "pr-2")}
        >
          <Inbox size={13} />
          Review
          {work.length > 0 ? (
            <span className="bg-primary-foreground/15 text-primary-foreground ml-0.5 flex min-w-4.5 items-center justify-center rounded-md px-1.5 py-0.5 text-[9px] leading-3 font-semibold tabular-nums shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary-foreground)_12%,transparent)]">
              {work.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl p-2">
        <div className="px-2 pt-1 pb-2">
          <p className="text-xs font-semibold">Review queue</p>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            Proposed agent work waiting for your approval.
          </p>
        </div>
        {work.length > 0 ? (
          <div className="space-y-1">
            {work.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item)}
                className="hover:bg-accent bg-foreground/[0.025] flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors"
              >
                <span className="bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded-md text-[9px] font-semibold tabular-nums">
                  {work.indexOf(item) + 1}
                </span>
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
          <p className="text-muted-foreground bg-foreground/[0.025] rounded-xl px-3 py-3 text-[10px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_5%,transparent)]">
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
  const revisionDriver = agentConfig.forAgent("chief").driver;
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
  const requestMonth = (month: Date) => {
    setMonthDirection(month > activeMonth ? 1 : -1);
    setScrollRequest((current) => ({ month, token: current.token + 1 }));
    setActiveMonth(month);
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
      <header className="shrink-0 px-8 pt-6 pb-5">
        <div>
          <PageTitle>Schedule</PageTitle>
          <p className="text-muted-foreground mt-1 text-[13px]">
            See what is coming up and approve proposed schedules.
          </p>
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
                  className="absolute inset-x-0 min-w-0 truncate text-xl font-medium tracking-[-0.025em]"
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
              byDay={byDay}
              recurringByDay={recurringByDay}
              showPosts={showPosts}
              showAgentWork={showAgentWork}
            />
          )}
        </div>
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
            (item) =>
              item.status === "open" &&
              item.id === `action-${work.id}-approval`,
          );
          if (actionItem) workspaceData.dismissActionItem(actionItem.id);
        }}
        onReject={(work) => {
          workspaceData.deleteRecurringWork(work.id);
          const actionItem = workspaceData.actionItems.find(
            (item) =>
              item.status === "open" &&
              item.id === `action-${work.id}-approval`,
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
