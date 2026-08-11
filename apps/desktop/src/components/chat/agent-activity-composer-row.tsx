import { MatrixLoader } from "@chief/ui/components/matrix-loader";

export function AgentActivityComposerRow({
  agentLabel = "Chief",
  running,
  statusLabel,
  onOpen,
}: {
  agentLabel?: string;
  running: boolean;
  statusLabel: string;
  onOpen: () => void;
}) {
  return (
    <div
      className="flex h-8 shrink-0 items-center px-1"
      aria-live="polite"
      aria-atomic="true"
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!running}
        tabIndex={running ? 0 : -1}
        aria-hidden={!running}
        className={
          "group/activity text-muted-foreground hover:text-foreground flex max-w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-[color,opacity] duration-150 " +
          (running
            ? "opacity-100"
            : "pointer-events-none opacity-0 select-none")
        }
        aria-label={`${statusLabel}. View activity.`}
      >
        <span className="bg-muted/35 grid size-[18px] shrink-0 place-items-center rounded-md">
          <MatrixLoader ariaLabel={`${agentLabel} is working`} size={13} />
        </span>
        <span className="chief-shimmer-text min-w-0 truncate text-[11px] font-medium">
          {statusLabel}
        </span>
        <span className="text-muted-foreground/70 shrink-0 text-[10px] opacity-0 transition-opacity group-hover/activity:opacity-100 group-focus-visible/activity:opacity-100">
          View activity
        </span>
      </button>
    </div>
  );
}
