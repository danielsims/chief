import { cn } from "../lib/utils";

/** A small filled confirmation mark that sits beside a heading. */
export function CheckBadge({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={cn("size-5 shrink-0", className)}
      role="img"
      aria-label="Done"
    >
      <circle cx="10" cy="10" r="10" className="fill-emerald-500" />
      <path
        d="M6 10.4l2.6 2.6L14 7.6"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
