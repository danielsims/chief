import { typingLabel } from "../../lib/use-channel-typing";

/** Fills the composer's activity slot while other people are typing. */
export function PeopleTypingRow({ names }: { names: readonly string[] }) {
  const label = typingLabel(names);
  return (
    <div
      className="flex h-8 shrink-0 items-center px-2.5"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="text-muted-foreground chief-shimmer-text min-w-0 truncate text-[11px] font-medium">
        {label}
      </span>
    </div>
  );
}
