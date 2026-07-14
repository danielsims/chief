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
        d="M29 12H12V29M35 12h17v12M29 52H12V35M35 52h17V40"
        stroke="currentColor"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        strokeWidth="6"
      />
    </svg>
  );
}
