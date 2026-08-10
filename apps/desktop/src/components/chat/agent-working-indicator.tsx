import { cn } from "@chief/ui/lib/utils";

export function AgentWorkingIndicator({ className }: { className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        "chief-shimmer-text text-left font-mono text-xs",
        className,
      )}
    >
      Working...
    </p>
  );
}
