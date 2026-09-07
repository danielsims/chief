import { useEffect, useRef, useState } from "react";
import { Pause, Pencil, Trash2 } from "lucide-react";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import type { CalendarView, ScheduledDraft } from "./schedule-calendar-core";
import {
  addDays,
  dayKey,
  DraftEventContent,
  eventSurface,
  startOfWeek,
  TIMELINE_END_HOUR,
  TIMELINE_ROW_HEIGHT,
  TIMELINE_START_HOUR,
  WorkEventContent,
  workOccurrences,
} from "./schedule-calendar-core";

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
      (elapsedMinutes / 60) *
        (timelineHeight / (TIMELINE_END_HOUR - TIMELINE_START_HOUR)),
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

export function FocusedCalendarView({
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
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(TIMELINE_ROW_HEIGHT);
  useEffect(() => {
    const container = containerRef.current;
    const header = headerRef.current;
    if (!container || !header) return;
    const resize = () => {
      const available = container.clientHeight - header.offsetHeight - 12;
      setRowHeight(
        Math.min(
          96,
          Math.max(
            TIMELINE_ROW_HEIGHT,
            available / (TIMELINE_END_HOUR - TIMELINE_START_HOUR),
          ),
        ),
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    observer.observe(header);
    resize();
    return () => observer.disconnect();
  }, []);
  const timelineHeight = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * rowHeight;
  const hours = Array.from(
    { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
    (_, index) => TIMELINE_START_HOUR + index,
  );

  return (
    <div
      ref={containerRef}
      className="h-full min-w-0 touch-pan-y [scrollbar-width:thin] [scrollbar-gutter:stable] overflow-y-scroll overscroll-contain"
    >
      <div
        ref={headerRef}
        className="bg-card/92 sticky top-0 z-30 backdrop-blur-xl"
      >
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
            style={{ top: index * rowHeight }}
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
                  const timestamp = workOccurrences(work).find(
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

export function RecurringWorkContextMenu({
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

export const CRON_FIELDS = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;
