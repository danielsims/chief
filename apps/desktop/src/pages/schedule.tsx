import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ContentDraftRecord } from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@marketer/ui/components/popover";
import { cn } from "@marketer/ui/lib/utils";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceData } from "../lib/runtime";

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

function buildContinuousWeeks(currentMonth: Date) {
  const first = startOfWeek(addMonths(currentMonth, -MONTHS_BEFORE));
  const finalMonth = addMonths(currentMonth, MONTHS_AFTER + 1);
  const weeks: Date[][] = [];
  let cursor = first;

  while (cursor < finalMonth) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)));
    cursor = addDays(cursor, 7);
  }

  return weeks;
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
    <div className="min-w-0 border bg-background px-2 py-1.5">
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

function DayCell({
  date,
  drafts,
  today,
  selected,
  onSelect,
  boundaryRow = false,
  tall = false,
}: {
  date: Date;
  drafts: ScheduledDraft[];
  today: Date;
  selected: Date;
  onSelect: (date: Date) => void;
  boundaryRow?: boolean;
  tall?: boolean;
}) {
  const key = dayKey(date);
  const isToday = key === dayKey(today);
  const isSelected = key === dayKey(selected);
  const visibleLimit = tall ? 8 : boundaryRow ? 2 : 3;

  return (
    <button
      type="button"
      onClick={() => onSelect(date)}
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
        {drafts.slice(0, visibleLimit).map((draft) => (
          <DraftChip key={draft.id} draft={draft} />
        ))}
        {drafts.length > visibleLimit ? (
          <p className="px-1 text-[10px] text-muted-foreground">
            +{drafts.length - visibleLimit} more
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
      color: "bg-violet-500",
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
  byDay,
  showPosts,
  scrollRequest,
}: {
  currentMonth: Date;
  activeMonth: Date;
  onActiveMonthChange: (month: Date) => void;
  today: Date;
  selected: Date;
  onSelect: (date: Date) => void;
  byDay: ReadonlyMap<string, ScheduledDraft[]>;
  showPosts: boolean;
  scrollRequest: { month: Date; token: number };
}) {
  const weeks = useMemo(
    () => buildContinuousWeeks(currentMonth),
    [currentMonth],
  );
  const months = useMemo(
    () =>
      Array.from({ length: MONTHS_BEFORE + MONTHS_AFTER + 1 }, (_, index) =>
        addMonths(currentMonth, index - MONTHS_BEFORE),
      ),
    [currentMonth],
  );
  const calendarRef = useRef<HTMLDivElement>(null);
  const monthRows = useRef(new Map<string, HTMLDivElement>());
  const scrollFrame = useRef<number | null>(null);
  const scrollTimer = useRef<number | null>(null);
  const scrollingRef = useRef(false);
  const [isScrolling, setIsScrolling] = useState(false);

  const scrollToMonth = (month: Date, behavior: ScrollBehavior) => {
    const container = calendarRef.current;
    const row = monthRows.current.get(monthKey(month));
    if (!container || !row) return;
    container.scrollTo({
      top: row.offsetTop - CALENDAR_HEADER_HEIGHT,
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
      if (scrollTimer.current !== null) {
        window.clearTimeout(scrollTimer.current);
      }
    },
    [],
  );

  const handleScroll = () => {
    if (!scrollingRef.current) {
      scrollingRef.current = true;
      setIsScrolling(true);
    }
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
    }
    scrollTimer.current = window.setTimeout(() => {
      scrollingRef.current = false;
      setIsScrolling(false);
    }, 160);

    if (scrollFrame.current !== null) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      const container = calendarRef.current;
      if (!container) return;
      const threshold = container.scrollTop + CALENDAR_HEADER_HEIGHT + 2;
      let nextMonth = months[0]!;
      for (const month of months) {
        const row = monthRows.current.get(monthKey(month));
        if (!row || row.offsetTop > threshold) break;
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

      {weeks.map((week) => {
        const boundary = week.find((date) => date.getDate() === 1);
        const boundaryKey = boundary ? monthKey(boundary) : null;
        return (
          <div
            key={dayKey(week[0]!)}
            ref={(node) => {
              if (!boundaryKey) return;
              if (node) monthRows.current.set(boundaryKey, node);
              else monthRows.current.delete(boundaryKey);
            }}
            className="relative grid grid-cols-7 border-l"
          >
            {boundary && !sameMonth(boundary, activeMonth) ? (
              <p
                className={cn(
                  "pointer-events-none absolute left-3 top-2 z-10 font-serif text-xl transition-[opacity,transform] duration-150",
                  isScrolling
                    ? "translate-y-0 opacity-100"
                    : "translate-y-1 opacity-0",
                )}
              >
                {monthLabel(boundary)}
              </p>
            ) : null}
            {week.map((date) => (
              <DayCell
                key={dayKey(date)}
                date={date}
                drafts={showPosts ? (byDay.get(dayKey(date)) ?? []) : []}
                today={today}
                selected={selected}
                onSelect={onSelect}
                boundaryRow={Boolean(boundary)}
              />
            ))}
          </div>
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
  byDay,
  showPosts,
}: {
  view: Exclude<CalendarView, "month">;
  selected: Date;
  today: Date;
  onSelect: (date: Date) => void;
  byDay: ReadonlyMap<string, ScheduledDraft[]>;
  showPosts: boolean;
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
            today={today}
            selected={selected}
            onSelect={onSelect}
            tall
          />
        ))}
      </div>
    </div>
  );
}

export function SchedulePage() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const currentMonth = useMemo(() => startOfMonth(today), [today]);
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<CalendarView>("month");
  const [activeMonth, setActiveMonth] = useState(currentMonth);
  const [scrollRequest, setScrollRequest] = useState({
    month: currentMonth,
    token: 0,
  });
  const [visibleKinds, setVisibleKinds] = useState<ReadonlySet<ScheduleKind>>(
    () => new Set<ScheduleKind>(["post", "agent-work"]),
  );
  const { cloudOrganizationId } = useAuth();
  const workspaceData = useWorkspaceData(cloudOrganizationId);

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

  const showPosts = visibleKinds.has("post");
  const selectedDrafts = showPosts ? (byDay.get(dayKey(selected)) ?? []) : [];

  const requestMonth = (month: Date) => {
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
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-5 border-b px-8 pb-5 pt-4">
        <div>
          <h1 className="font-serif text-3xl">Schedule</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Planned content and recurring agent work.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        <p className="min-w-0 truncate font-serif text-xl">
          {view === "month" ? monthLabel(activeMonth) : focusedHeading}
        </p>
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
              onActiveMonthChange={setActiveMonth}
              today={today}
              selected={selected}
              onSelect={setSelected}
              byDay={byDay}
              showPosts={showPosts}
              scrollRequest={scrollRequest}
            />
          ) : (
            <FocusedCalendarView
              view={view}
              selected={selected}
              today={today}
              onSelect={setSelected}
              byDay={byDay}
              showPosts={showPosts}
            />
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-l p-5">
          <p className="text-xs text-muted-foreground">
            {selected.toLocaleDateString([], { weekday: "long" })}
          </p>
          <h2 className="mt-1 font-serif text-2xl">
            {selected.toLocaleDateString([], { month: "long", day: "numeric" })}
          </h2>
          <div className="mt-6 space-y-2">
            {selectedDrafts.map((draft) => (
              <DraftChip key={draft.id} draft={draft} />
            ))}
            {selectedDrafts.length === 0 ? (
              <div className="flex min-h-[420px] items-center justify-center text-center">
                <p className="text-sm text-muted-foreground">
                  Nothing scheduled
                </p>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
