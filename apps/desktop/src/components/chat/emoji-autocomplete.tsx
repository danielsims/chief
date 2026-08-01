import { useEffect, useRef } from "react";

import { cn } from "@chief/ui/lib/utils";

import type { EmojiOption } from "./emoji-catalog";

export function EmojiAutocomplete({
  suggestions,
  selectedIndex,
  onSelect,
}: {
  suggestions: readonly EmojiOption[];
  selectedIndex: number;
  onSelect: (suggestion: EmojiOption) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeItem = listRef.current?.children[selectedIndex] as
      HTMLElement | undefined;
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (suggestions.length === 0) return null;

  return (
    <div className="absolute right-0 bottom-full left-0 z-50 mb-1 px-3 sm:px-4">
      <div
        ref={listRef}
        className="border-border/60 text-popover-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:zoom-in-95 max-h-48 origin-bottom overflow-y-auto rounded-xl border bg-[color-mix(in_srgb,var(--background)_80%,var(--muted)_20%)] p-1 shadow-[0_6px_18px_rgba(0,0,0,0.04),0_3px_9px_rgba(0,0,0,0.08),0_1px_1px_rgba(0,0,0,0.08)] motion-safe:duration-150"
      >
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion.shortcode}
            type="button"
            tabIndex={-1}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(suggestion);
            }}
            className={cn(
              "text-popover-foreground flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50",
            )}
          >
            <span className="text-lg leading-none">{suggestion.emoji}</span>
            <span className="text-muted-foreground truncate">
              :{suggestion.shortcode}:
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
