import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import { monthLabel, sameMonth } from "./schedule-calendar-core";

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
          className="hover:bg-accent/45 group flex h-8 min-w-0 items-center gap-1.5 rounded-lg pr-1.5 text-xl font-medium tracking-[-0.025em] transition-colors"
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
