import type { MouseEvent } from "react";
import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function chatDayKey(timestamp: number | undefined) {
  return timestamp ? String(startOfDay(timestamp)) : null;
}

export function MessageTimestamp({ timestamp }: { timestamp?: number }) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return (
    <time
      dateTime={date.toISOString()}
      className="text-muted-foreground/70 text-[10px] font-normal tabular-nums"
      title={date.toLocaleString()}
    >
      {TIME_FORMATTER.format(date)}
    </time>
  );
}

function separatorLabel(timestamp: number, now: number) {
  const day = startOfDay(timestamp);
  const today = startOfDay(now);
  if (day === today) return "Today";
  if (day === today - 86_400_000) return "Yesterday";
  return DATE_FORMATTER.format(timestamp);
}

function jumpWithinTimeline(source: HTMLElement, timestamp: number) {
  const timeline = source.closest<HTMLElement>("[data-chat-timeline]");
  if (!timeline) return;
  const starts = [...timeline.querySelectorAll<HTMLElement>("[data-chat-day]")]
    .map((element) => ({
      element,
      timestamp: Number(element.dataset.chatDay),
    }))
    .filter((candidate) => Number.isFinite(candidate.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);
  const target =
    starts.find((candidate) => candidate.timestamp >= startOfDay(timestamp)) ??
    starts.at(-1);
  target?.element.scrollIntoView({ behavior: "smooth", block: "start" });
}

function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function ChatDateSeparator({ timestamp }: { timestamp?: number }) {
  const [open, setOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(new Date(timestamp ?? Date.now()).setDate(1)),
  );
  if (!timestamp) return null;
  const day = startOfDay(timestamp);
  const jump = (event: MouseEvent<HTMLElement>, target: number) => {
    jumpWithinTimeline(event.currentTarget, target);
    setOpen(false);
  };
  return (
    <div
      data-chat-day={day}
      className="relative mx-auto my-3 flex w-full max-w-3xl items-center justify-center"
    >
      <span className="bg-border/70 absolute inset-x-0 h-px" />
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setCalendarOpen(false);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="bg-background hover:bg-muted relative flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium shadow-sm transition-colors"
          >
            {separatorLabel(timestamp, now)}
            <ChevronDown size={11} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          className={calendarOpen ? "w-72 p-2" : "w-56 p-1.5"}
        >
          {calendarOpen ? (
            <div>
              <div className="flex items-center gap-2 px-1 pb-2">
                <button
                  type="button"
                  aria-label="Back to date shortcuts"
                  onClick={() => setCalendarOpen(false)}
                  className="hover:bg-muted grid size-7 place-items-center rounded-md"
                >
                  <ChevronLeft size={14} />
                </button>
                <p className="flex-1 text-center text-xs font-medium">
                  {MONTH_FORMATTER.format(visibleMonth)}
                </p>
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() =>
                    setVisibleMonth(
                      new Date(
                        visibleMonth.getFullYear(),
                        visibleMonth.getMonth() - 1,
                        1,
                      ),
                    )
                  }
                  className="hover:bg-muted grid size-7 place-items-center rounded-md"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() =>
                    setVisibleMonth(
                      new Date(
                        visibleMonth.getFullYear(),
                        visibleMonth.getMonth() + 1,
                        1,
                      ),
                    )
                  }
                  className="hover:bg-muted grid size-7 place-items-center rounded-md"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="text-muted-foreground grid grid-cols-7 text-center text-[9px]">
                {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                  <span key={`${day}:${index}`} className="py-1">
                    {day}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {monthGrid(visibleMonth).map((date) => {
                  const outside = date.getMonth() !== visibleMonth.getMonth();
                  const selected = startOfDay(date.getTime()) === day;
                  return (
                    <button
                      key={date.toISOString()}
                      type="button"
                      onClick={(event) => jump(event, date.getTime())}
                      className={`hover:bg-muted grid aspect-square place-items-center rounded-md text-[11px] ${outside ? "text-muted-foreground/35" : ""} ${selected ? "bg-foreground text-background hover:bg-foreground" : ""}`}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground px-2 py-1.5 text-[10px] font-medium">
                Jump to
              </p>
              {[
                ["Yesterday", now - 86_400_000],
                ["Last week", now - 7 * 86_400_000],
                ["Last month", now - 30 * 86_400_000],
                ["The very beginning", 0],
              ].map(([label, target]) => (
                <button
                  key={String(label)}
                  type="button"
                  onClick={(event) => jump(event, Number(target))}
                  className="hover:bg-muted flex h-8 w-full items-center rounded-md px-2 text-left text-xs transition-colors"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                className="border-border/70 hover:bg-muted mt-1 flex h-9 w-full items-center border-t px-2 pt-1 text-left text-xs transition-colors"
              >
                Jump to a specific date
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
