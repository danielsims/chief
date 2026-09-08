import { useEffect, useRef } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import { AgentAvatar } from "../agent-avatar";

export interface MentionCandidate {
  id: string;
  name: string;
  role: string;
  member: boolean;
}

export function ComposerMentionPopover({
  selectedIndex,
  suggestions,
  onDismiss,
  onSelect,
}: {
  selectedIndex: number;
  suggestions: readonly MentionCandidate[];
  onDismiss: () => void;
  onSelect: (candidate: MentionCandidate) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (suggestions.length === 0) return null;

  return (
    <Popover open onOpenChange={(open) => !open && onDismiss()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 top-0 h-px"
        />
      </PopoverAnchor>
      <PopoverContent
        role="listbox"
        side="top"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="max-h-56 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1 shadow-[0_14px_38px_-12px_rgb(0_0_0/0.2)] dark:shadow-[0_14px_38px_-12px_rgb(0_0_0/0.8)]"
      >
        {suggestions.map((candidate, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={candidate.id}
              ref={selected ? selectedRef : undefined}
              type="button"
              role="option"
              aria-selected={selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(candidate)}
              className={cn(
                "hover:bg-accent/60 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors outline-none",
                selected && "bg-accent",
              )}
            >
              <AgentAvatar
                agentId={candidate.id}
                label={candidate.name}
                className="size-7"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-5 font-medium tracking-[-0.01em]">
                  {candidate.name}
                </span>
                <span className="text-muted-foreground flex min-w-0 items-center text-xs leading-4 font-normal">
                  <span className="truncate">{candidate.role}</span>
                </span>
              </span>
              {!candidate.member ? (
                <span className="text-muted-foreground/80 shrink-0 text-xs leading-4 font-normal">
                  Add to channel
                </span>
              ) : null}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
