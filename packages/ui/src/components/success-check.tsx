import { cn } from "../lib/utils";

const RING_LENGTH = 2 * Math.PI * 27;
const CHECK_LENGTH = 30;

/**
 * Confirmation mark for earned completion moments: a thin ring draws in,
 * then the check strokes through it. Static under reduced motion.
 */
export function SuccessCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 60 60"
      className={cn("size-14 text-emerald-500", className)}
      role="img"
      aria-label="Success"
    >
      <circle
        cx="30"
        cy="30"
        r="27"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH}
        transform="rotate(-90 30 30)"
        className="success-ring"
      />
      <path
        d="M20 30.5 27 37.5 40.5 23.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={CHECK_LENGTH}
        strokeDashoffset={CHECK_LENGTH}
        className="success-check"
      />
    </svg>
  );
}
