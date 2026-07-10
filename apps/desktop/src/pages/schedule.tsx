import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ContentDraftRecord } from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import { cn } from "@marketer/ui/lib/utils";
import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceData } from "../lib/runtime";

type ScheduledDraft = ContentDraftRecord;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_BEFORE = 12;
const MONTHS_AFTER = 24;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
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

function buildMonthCells(month: Date): Array<Date | null> {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const leadingCells = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((leadingCells + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - leadingCells + 1;
    return day >= 1 && day <= daysInMonth
      ? new Date(year, monthIndex, day)
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
    <div className="border bg-background px-2 py-1.5">
      <div className="flex items-center gap-1.5">
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

export function SchedulePage() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const currentMonth = useMemo(() => startOfMonth(today), [today]);
  const [selected, setSelected] = useState(today);
  const calendarRef = useRef<HTMLDivElement>(null);
  const monthRefs = useRef(new Map<string, HTMLElement>());
  const { cloudOrganizationId } = useAuth();
  const workspaceData = useWorkspaceData(cloudOrganizationId);

  const months = useMemo(
    () =>
      Array.from({ length: MONTHS_BEFORE + MONTHS_AFTER + 1 }, (_, index) =>
        addMonths(currentMonth, index - MONTHS_BEFORE),
      ),
    [currentMonth],
  );

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

  const scrollToMonth = (month: Date) => {
    const container = calendarRef.current;
    const section = monthRefs.current.get(monthKey(month));
    if (!container || !section) return;
    container.scrollTo({
      top: section.offsetTop - 33,
      behavior: "smooth",
    });
  };

  useLayoutEffect(() => {
    const container = calendarRef.current;
    const section = monthRefs.current.get(monthKey(currentMonth));
    if (!container || !section) return;
    container.scrollTop = section.offsetTop - 33;
  }, [currentMonth]);

  const selectedDrafts = byDay.get(dayKey(selected)) ?? [];

  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-end justify-between gap-5 border-b px-8 pb-5 pt-4">
        <div>
          <h1 className="font-serif text-3xl">Schedule</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Planned content across every channel.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSelected(today);
            scrollToMonth(currentMonth);
          }}
        >
          Today
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
        <section
          ref={calendarRef}
          className="relative min-w-0 overflow-y-auto overscroll-contain"
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
                  if (node) monthRefs.current.set(key, node);
                  else monthRefs.current.delete(key);
                }}
                className="relative"
              >
                <div className="sticky top-9 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur-lg">
                  <h2 className="font-serif text-2xl">
                    {month.toLocaleDateString([], {
                      month: "long",
                      year: "numeric",
                    })}
                  </h2>
                </div>
                <div className="grid grid-cols-7 border-l">
                  {cells.map((date, index) => {
                    if (!date) {
                      return (
                        <div
                          // The position is stable inside this month grid.
                          key={`empty-${index}`}
                          aria-hidden="true"
                          className="min-h-28 border-b border-r bg-muted/[0.025]"
                        />
                      );
                    }

                    const dateKey = dayKey(date);
                    const items = byDay.get(dateKey) ?? [];
                    const isToday = dateKey === dayKey(today);
                    const isSelected = dateKey === dayKey(selected);
                    return (
                      <button
                        key={dateKey}
                        type="button"
                        onClick={() => setSelected(date)}
                        className={cn(
                          "min-h-28 min-w-0 border-b border-r p-2 text-left align-top transition-colors hover:bg-accent/30",
                          isSelected && "bg-accent/40",
                        )}
                      >
                        <span
                          className={cn(
                            "relative inline-block text-xs leading-none",
                            isToday &&
                              "font-medium after:absolute after:-bottom-1 after:left-0 after:h-px after:w-3 after:bg-foreground",
                          )}
                        >
                          {date.getDate()}
                        </span>
                        <div className="mt-2 min-w-0 space-y-1">
                          {items.slice(0, 3).map((draft) => (
                            <DraftChip key={draft.id} draft={draft} />
                          ))}
                          {items.length > 3 ? (
                            <p className="px-1 text-[10px] text-muted-foreground">
                              +{items.length - 3} more
                            </p>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
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
