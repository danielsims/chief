import { useMemo, useState } from "react";
import { Check, ChevronDown, GitBranch, Search } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

export function ProjectBranchPicker({
  branches,
  current,
  defaultBranch,
  onSelect,
}: {
  branches: string[];
  current: string;
  defaultBranch: string;
  onSelect: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return branches
      .filter((branch) => branch.toLowerCase().includes(normalized))
      .sort((left, right) => {
        if (left === defaultBranch) return -1;
        if (right === defaultBranch) return 1;
        return left.localeCompare(right);
      });
  }, [branches, defaultBranch, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-56 max-w-full min-w-0 justify-start overflow-hidden [&_[data-slot=button-content]]:w-full [&_[data-slot=button-content]]:min-w-0"
        >
          <GitBranch size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{current}</span>
          <ChevronDown
            size={13}
            className="text-muted-foreground ml-auto shrink-0"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="relative">
          <Search
            size={14}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
          />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a branch"
            className="h-9 pl-8 text-[13px]"
          />
        </div>
        <div className="mt-1 max-h-64 overflow-y-auto">
          {filtered.map((branch) => (
            <button
              type="button"
              key={branch}
              onClick={() => {
                onSelect(branch);
                setOpen(false);
              }}
              className={cn(
                "hover:bg-accent flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px]",
                branch === current && "bg-accent/60",
              )}
            >
              <span className="flex size-4 items-center justify-center">
                {branch === current ? <Check size={13} /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{branch}</span>
              {branch === defaultBranch ? (
                <span className="text-muted-foreground text-[12px]">
                  Default
                </span>
              ) : null}
            </button>
          ))}
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-3 py-5 text-center text-[13px]">
              No branches found
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
