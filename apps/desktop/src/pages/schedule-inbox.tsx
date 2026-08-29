import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Inbox } from "lucide-react";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import { agentName, monthLabel, sameMonth } from "./schedule-calendar-core";
import { friendlySchedule } from "./schedule-editor";

export function MonthJump({
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

export function ScheduleInbox({
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
