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
  Play,
  Plus,
  Repeat2,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceData } from "../lib/runtime";
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

function RecurringWorkChip({ work }: { work: RecurringWorkRecord }) {
  return (
    <div className="min-w-0 border border-violet-500/25 bg-violet-500/[0.06] px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="size-1.5 shrink-0 bg-violet-500" />
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

function DayCell({
  date,
  drafts,
  recurringWork,
  today,
  selected,
  onSelect,
  onContextMenu,
  boundaryRow = false,
  tall = false,
}: {
  date: Date;
  drafts: ScheduledDraft[];
  recurringWork: RecurringWorkRecord[];
  today: Date;
  selected: Date;
  onSelect: (date: Date) => void;
  onContextMenu?: (date: Date, x: number, y: number) => void;
  boundaryRow?: boolean;
  tall?: boolean;
}) {
  const key = dayKey(date);
  const isToday = key === dayKey(today);
  const isSelected = key === dayKey(selected);
  const visibleLimit = tall ? 8 : boundaryRow ? 2 : 3;
  const draftLimit = Math.max(0, visibleLimit - recurringWork.length);

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
        {recurringWork.slice(0, visibleLimit).map((work) => (
          <RecurringWorkChip key={work.id} work={work} />
        ))}
        {drafts.slice(0, draftLimit).map((draft) => (
          <DraftChip key={draft.id} draft={draft} />
        ))}
        {drafts.length + recurringWork.length > visibleLimit ? (
          <p className="px-1 text-[10px] text-muted-foreground">
            +{drafts.length + recurringWork.length - visibleLimit} more
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
  onDateContext,
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
  selected: Date;
  onSelect: (date: Date) => void;
  onDateContext: (date: Date, x: number, y: number) => void;
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
            <p className="pointer-events-none absolute left-3 top-2 z-10 font-serif text-xl">
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
                  today={today}
                  selected={selected}
                  onSelect={onSelect}
                  onContextMenu={onDateContext}
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
  byDay,
  recurringByDay,
  showPosts,
  showAgentWork,
}: {
  view: Exclude<CalendarView, "month">;
  selected: Date;
  today: Date;
  onSelect: (date: Date) => void;
  onDateContext: (date: Date, x: number, y: number) => void;
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
            today={today}
            selected={selected}
            onSelect={onSelect}
            onContextMenu={onDateContext}
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

function RecurringWorkApprovalDialog({
  work,
  onClose,
  onApprove,
}: {
  work: RecurringWorkRecord | null;
  onClose: () => void;
  onApprove: (work: RecurringWorkRecord) => void;
}) {
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
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Not now
              </Button>
              <Button
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
}: {
  work: RecurringWorkRecord;
  onReview: () => void;
  onToggle: () => void;
  onRun: () => void;
}) {
  const approvalNeeded =
    work.status === "draft" || work.status === "needs_approval";
  return (
    <div className="border border-violet-500/25 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1 size-2 shrink-0 bg-violet-500" />
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
            Review approval
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
  const [approvalWork, setApprovalWork] = useState<RecurringWorkRecord | null>(
    null,
  );
  const [dateMenu, setDateMenu] = useState<{
    date: Date;
    x: number;
    y: number;
  } | null>(null);
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
  const selectedDrafts = showPosts ? (byDay.get(dayKey(selected)) ?? []) : [];
  const selectedRecurringWork = showAgentWork
    ? (recurringByDay.get(dayKey(selected)) ?? [])
    : [];
  const pendingApprovals = workspaceData.recurringWork.filter(
    (work) => work.status === "draft" || work.status === "needs_approval",
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
              onSelect={setSelected}
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
        </section>

        <aside className="min-h-0 overflow-y-auto border-l p-5">
          {pendingApprovals.length > 0 ? (
            <div className="mb-6 space-y-2 border-b pb-5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Needs your approval
              </p>
              {pendingApprovals.map((work) => (
                <RecurringWorkDetail
                  key={work.id}
                  work={work}
                  onReview={() => setApprovalWork(work)}
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
            {selectedDrafts.map((draft) => (
              <DraftChip key={draft.id} draft={draft} />
            ))}
            {selectedRecurringWork.map((work) => (
              <RecurringWorkDetail
                key={work.id}
                work={work}
                onReview={() => setApprovalWork(work)}
                onRun={() => workspaceData.runRecurringWorkNow(work.id)}
                onToggle={() =>
                  workspaceData.saveRecurringWork({
                    ...work,
                    status: work.status === "active" ? "paused" : "active",
                    updatedAt: Date.now(),
                  })
                }
              />
            ))}
            {selectedDrafts.length === 0 &&
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
      <RecurringWorkApprovalDialog
        work={approvalWork}
        onClose={() => setApprovalWork(null)}
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
      />
      <CalendarContextMenu
        context={dateMenu}
        onClose={() => setDateMenu(null)}
        onAction={handleDateAction}
      />
    </div>
  );
}
