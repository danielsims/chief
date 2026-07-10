import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import { Button } from "@marketer/ui/components/button";
import { cn } from "@marketer/ui/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "../lib/auth/auth-context";

type CalendarView = "month" | "week";

interface ScheduledDraft {
  _id: string;
  title: string;
  platform: string;
  status: "draft" | "approved" | "scheduled" | "published";
  scheduledFor?: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const result = startOfDay(date);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function addDays(date: Date, count: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildDays(anchor: Date, view: CalendarView) {
  const first =
    view === "week"
      ? startOfWeek(anchor)
      : startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const count = view === "week" ? 7 : 42;
  return Array.from({ length: count }, (_, index) => addDays(first, index));
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
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<CalendarView>("month");
  const days = useMemo(() => buildDays(anchor, view), [anchor, view]);
  const rangeStart = days[0]!.getTime();
  const rangeEnd = addDays(days.at(-1)!, 1).getTime() - 1;
  const { cloudOrganizationId } = useAuth();
  const convexAuth = useConvexAuth();
  const canQuery = convexAuth.isAuthenticated && Boolean(cloudOrganizationId);
  const drafts = useQuery(
    api.scheduledDrafts.listRange,
    canQuery ? { start: rangeStart, end: rangeEnd } : "skip",
  ) as ScheduledDraft[] | undefined;

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduledDraft[]>();
    for (const draft of drafts ?? []) {
      if (!draft.scheduledFor) continue;
      const key = dayKey(new Date(draft.scheduledFor));
      const current = map.get(key) ?? [];
      current.push(draft);
      map.set(key, current);
    }
    return map;
  }, [drafts]);
  const selectedDrafts = byDay.get(dayKey(selected)) ?? [];
  const heading =
    view === "month"
      ? anchor.toLocaleDateString([], { month: "long", year: "numeric" })
      : `${days[0]!.toLocaleDateString([], { month: "short", day: "numeric" })} – ${days.at(-1)!.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;

  const move = (direction: number) => {
    const next = new Date(anchor);
    if (view === "month") next.setMonth(next.getMonth() + direction, 1);
    else next.setDate(next.getDate() + direction * 7);
    setAnchor(next);
  };

  return (
    <div className="-mx-8 -mb-8 min-h-[calc(100vh-48px)]">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b px-8 pb-5 pt-4">
        <div>
          <h1 className="font-serif text-3xl">Schedule</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Planned content across every channel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAnchor(today);
              setSelected(today);
            }}
          >
            Today
          </Button>
          <div className="flex border p-0.5">
            {(["month", "week"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={cn(
                  "px-3 py-1.5 text-xs capitalize text-muted-foreground transition-colors hover:text-foreground",
                  view === item && "bg-accent text-foreground",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-164px)] grid-cols-[minmax(0,1fr)_280px]">
        <section className="min-w-0 p-6 pr-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-serif text-2xl">{heading}</h2>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => move(-1)}>
                <ChevronLeft size={15} />
              </Button>
              <Button variant="outline" size="icon" onClick={() => move(1)}>
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-l border-t">
            {WEEKDAYS.map((weekday) => (
              <div
                key={weekday}
                className="border-b border-r px-3 py-2 text-[11px] text-muted-foreground"
              >
                {weekday}
              </div>
            ))}
            {days.map((date) => {
              const key = dayKey(date);
              const items = byDay.get(key) ?? [];
              const isToday = key === dayKey(today);
              const isSelected = key === dayKey(selected);
              const outside =
                view === "month" && date.getMonth() !== anchor.getMonth();
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(date)}
                  className={cn(
                    "min-h-28 border-b border-r p-2 text-left align-top transition-colors hover:bg-accent/40",
                    view === "week" && "min-h-[420px]",
                    isSelected && "bg-accent/50",
                  )}
                >
                  <span
                    className={cn(
                      "relative flex size-6 items-center justify-center text-xs",
                      outside && "text-muted-foreground/50",
                      isToday &&
                        "font-medium after:absolute after:bottom-0 after:h-px after:w-3 after:bg-foreground",
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <div className="mt-2 space-y-1">
                    {items.slice(0, view === "week" ? 8 : 3).map((draft) => (
                      <DraftChip key={draft._id} draft={draft} />
                    ))}
                    {items.length > (view === "week" ? 8 : 3) ? (
                      <p className="px-1 text-[10px] text-muted-foreground">
                        +{items.length - (view === "week" ? 8 : 3)} more
                      </p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="border-l p-5">
          <p className="text-xs text-muted-foreground">
            {selected.toLocaleDateString([], { weekday: "long" })}
          </p>
          <h2 className="mt-1 font-serif text-2xl">
            {selected.toLocaleDateString([], { month: "long", day: "numeric" })}
          </h2>
          <div className="mt-6 space-y-2">
            {selectedDrafts.map((draft) => (
              <DraftChip key={draft._id} draft={draft} />
            ))}
            {selectedDrafts.length === 0 ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Nothing scheduled
                </p>
                <p className="mt-1 max-w-48 text-xs leading-5 text-muted-foreground/70">
                  Agent suggestions and approved posts will appear here.
                </p>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
