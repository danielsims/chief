import Link from "next/link";

import { cn } from "@chief/ui/lib/utils";

export function ChiefMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 64 64"
    >
      <path
        d="M29 12H19a7 7 0 0 0-7 7v10M35 12h10a7 7 0 0 1 7 7v5M29 52H19a7 7 0 0 1-7-7V35M35 52h10a7 7 0 0 0 7-7v-5"
        stroke="currentColor"
        strokeLinecap="butt"
        strokeLinejoin="round"
        strokeWidth="4.5"
      />
    </svg>
  );
}

export function ChiefWordmark({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <Link
      aria-label="Chief home"
      className={cn(
        "text-foreground inline-flex items-center gap-[9px] font-medium",
        className,
      )}
      href="/"
    >
      <ChiefMark className={cn("shrink-0", markClassName ?? "size-[25px]")} />
      <span>chief</span>
    </Link>
  );
}
