import { useEffect, useState } from "react";

import { Button } from "@chief/ui/components/button";

import { ChiefMark } from "./chief-mark";

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
