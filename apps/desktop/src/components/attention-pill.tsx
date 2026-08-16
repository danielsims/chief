import { CircleAlert } from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

export function AttentionPill({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      aria-label="Requires attention"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-emerald-400/15 bg-emerald-500/10 text-[12px] leading-4 font-normal tracking-normal text-emerald-300/90",
        compact ? "size-5 p-0" : "gap-1.5 px-2.5 py-0.5",
        className,
      )}
    >
      <CircleAlert aria-hidden size={compact ? 12 : 13} strokeWidth={1.8} />
      {!compact ? "Requires attention" : null}
    </span>
  );
}
