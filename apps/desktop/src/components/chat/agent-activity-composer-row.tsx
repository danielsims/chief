import { AgentAvatar } from "../agent-avatar";

export function AgentActivityComposerRow({
  running,
  statusLabel,
  onOpen,
}: {
  running: boolean;
  statusLabel: string;
  onOpen: () => void;
}) {
  if (!running) return null;

  return (
    <div className="flex h-8 items-center px-1" aria-live="polite">
      <button
        type="button"
        onClick={onOpen}
        className="group/activity text-muted-foreground hover:text-foreground flex max-w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors"
        aria-label={`${statusLabel}. View activity.`}
      >
        <AgentAvatar label="Chief" className="size-[18px]" />
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
