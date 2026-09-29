import { cn } from "@chief/ui/lib/utils";

import { ChiefMark } from "../chief-mark";

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn("shrink-0", className)}
    >
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

/** Chief and GitHub, joined the same way the relay illustration joins a relay. */
export function GitHubConnectIllustration({
  waiting = false,
}: {
  waiting?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="relative flex items-center justify-center"
    >
      <div className="bg-background relative grid size-14 place-items-center rounded-2xl border shadow-sm">
        <ChiefMark className="size-6" />
      </div>
      <div className="relative flex w-20 items-center justify-center">
        <div className="border-muted-foreground/30 absolute inset-x-0 border-t border-dashed" />
        <span
          className={cn(
            "bg-card border-muted-foreground/40 relative size-2 rounded-full border",
            waiting && "motion-safe:animate-pulse",
          )}
        />
      </div>
      <div className="bg-background relative grid size-14 place-items-center rounded-2xl border shadow-sm">
        <GitHubMark className="size-6" />
      </div>
    </div>
  );
}
