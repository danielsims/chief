import { useEffect, useState } from "react";

import { Button } from "@chief/ui/components/button";
import { Skeleton } from "@chief/ui/components/skeleton";

import { ChiefMark } from "./chief-mark";

const SIDEBAR_GROUPS = [3, 5] as const;
const CONTENT_ROWS = ["first", "second", "third"] as const;

/**
 * Full-screen state for app entry while workspace access resolves. One stable
 * visual for every pre-app phase, and after a bounded wait it becomes an
 * honest recovery state with Retry instead of an infinite hold.
 */
export function EntryState({ timeoutMs = 12_000 }: { timeoutMs?: number }) {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [timeoutMs]);

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center">
      <ChiefMark className="text-foreground h-10 w-10" />
      <div className="bg-border mt-6 h-px w-24 overflow-hidden">
        <div className="entry-progress bg-foreground/50 h-full w-1/3" />
      </div>
      <div className="flex h-24 flex-col items-center justify-start gap-3 pt-8 text-center">
        {stalled ? (
          <>
            <p className="text-muted-foreground max-w-xs text-sm">
              Reaching your workspace is taking longer than expected.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function WorkspaceEntryState({
  revealDelayMs = 160,
}: {
  revealDelayMs?: number;
}) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), revealDelayMs);
    return () => window.clearTimeout(timer);
  }, [revealDelayMs]);

  return (
    <div
      role="status"
      aria-label="Loading workspace"
      className={`bg-sidebar text-foreground flex h-dvh overflow-hidden transition-opacity duration-150 ${revealed ? "opacity-100" : "opacity-0"}`}
    >
      <div className="flex w-12 shrink-0 flex-col items-center">
        <div className="h-10 shrink-0" data-tauri-drag-region />
        <div className="flex flex-1 flex-col items-center gap-2 pt-1">
          <div className="bg-foreground flex size-8 items-center justify-center rounded-[9px]">
            <ChiefMark className="text-background size-4" />
          </div>
          <Skeleton className="size-8 rounded-[12px] opacity-45" />
        </div>
        <Skeleton className="mb-3 size-8 rounded-[10px] opacity-35" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex h-10 shrink-0 items-center gap-2 pl-8"
          data-tauri-drag-region
        >
          <Skeleton className="size-7 rounded-md opacity-45" />
          <Skeleton className="h-3 w-12 opacity-35" />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <aside className="w-[300px] shrink-0 px-4 pt-3">
            <Skeleton className="h-8 w-full rounded-lg opacity-55" />
            <div className="mt-5 space-y-5">
              {SIDEBAR_GROUPS.map((rowCount, groupIndex) => (
                <div key={rowCount} className="space-y-3">
                  <Skeleton className="h-3 w-16 opacity-35" />
                  {Array.from({ length: rowCount }, (_, rowIndex) => (
                    <div
                      key={`${groupIndex}-${rowIndex}`}
                      className="flex items-center gap-3"
                    >
                      <Skeleton className="size-4 rounded opacity-40" />
                      <Skeleton
                        className={`h-3 opacity-40 ${rowIndex % 2 === 0 ? "w-24" : "w-32"}`}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </aside>

          <main className="bg-background relative mt-px mr-2 mb-2 ml-px flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
            <div className="p-8">
              <Skeleton className="h-8 w-40 opacity-55" />
              <Skeleton className="mt-3 h-3 w-72 max-w-full opacity-35" />
              <div className="mt-10 grid grid-cols-3 gap-3">
                {CONTENT_ROWS.map((row) => (
                  <div
                    key={row}
                    className="border-border/60 space-y-4 rounded-xl border p-5"
                  >
                    <Skeleton className="size-10 rounded-full opacity-50" />
                    <Skeleton className="h-4 w-24 opacity-45" />
                    <Skeleton className="h-3 w-2/3 opacity-30" />
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
