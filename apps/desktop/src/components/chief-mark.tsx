import { cn } from "@chief/ui/lib/utils";

export function ChiefMark({
  className,
  title = "Chief",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      aria-label={title}
      className={cn("shrink-0", className)}
      fill="none"
      role="img"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
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
