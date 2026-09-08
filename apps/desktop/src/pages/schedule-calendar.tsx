import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Check, SlidersHorizontal } from "lucide-react";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type { ScheduledDraft, ScheduleKind } from "./schedule-calendar-core";
import {
  addMonths,
  buildMonthCells,
  dayKey,
  DraftEventContent,
  eventSurface,
  monthKey,
  monthLabel,
  sameMonth,
  WEEKDAYS,
  WorkEventContent,
  workOccurrences,
} from "./schedule-calendar-core";

const MONTHS_BEFORE = 12;
const MONTHS_AFTER = 12;
const CALENDAR_HEADER_HEIGHT = 40;
const MONTH_TITLE_HANDOFF_DISTANCE = 64;

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
        if (!onContextMenu || past) return;
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
            past={
              !workOccurrences(work).some(
                (at) => dayKey(new Date(at)) === key && at > now,
              )
            }
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

export function ScheduleFilters({
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

export function ContinuousMonthView({
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
        addMonths(scrollRequest.month, index - MONTHS_BEFORE),
      ),
    [scrollRequest.month],
  );
  const calendarRef = useRef<HTMLDivElement>(null);
  const monthSections = useRef(new Map<string, HTMLElement>());
  const scrollFrame = useRef<number | null>(null);
  const programmaticMonth = useRef<string | null>(null);
  const scrollEndTimer = useRef<number | null>(null);

  const scrollToMonth = useCallback((month: Date, behavior: ScrollBehavior) => {
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
  }, []);

  useLayoutEffect(() => {
    scrollToMonth(
      scrollRequest.month,
      scrollRequest.token === 0 ? "auto" : "smooth",
    );
    onActiveMonthChange(scrollRequest.month);
  }, [
    onActiveMonthChange,
    scrollRequest.month,
    scrollRequest.token,
    scrollToMonth,
  ]);

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
      container.getBoundingClientRect().top +
      CALENDAR_HEADER_HEIGHT +
      MONTH_TITLE_HANDOFF_DISTANCE;
    const firstMonth = months.at(0);
    if (!firstMonth) return;
    let nextMonth = firstMonth;
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
      className="relative h-full min-w-0 touch-pan-y [scrollbar-width:thin] [scrollbar-gutter:stable] overflow-y-scroll overscroll-contain"
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
                  className="calendar-empty-day min-h-28 border-r border-b border-black/[0.055] dark:border-white/[0.055]"
                />
              ),
            )}
          </section>
        );
      })}
    </div>
  );
}

export const TIMELINE_EVENT_HEIGHT = 44;
export const TIMELINE_EVENT_GAP = 3;
