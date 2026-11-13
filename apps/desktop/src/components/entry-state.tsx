import { useEffect, useState } from "react";

import { Button } from "@chief/ui/components/button";

import { SplashProgress } from "./splash-surface";

/**
 * Refreshing a signed-in app stays on its existing background. Only the
 * sign-in screen uses the sky. A stalled connection still offers recovery.
 */
export function EntryState({ timeoutMs = 12_000 }: { timeoutMs?: number }) {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [timeoutMs]);

  return (
    <main className="bg-background text-foreground flex h-dvh items-center justify-center">
      {stalled ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-muted-foreground max-w-xs text-center text-sm leading-relaxed">
            Reaching your workspace is taking longer than expected.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </main>
  );
}

/**
 * Workspace refresh stays neutral; fast loads show only the app background.
 */
export function WorkspaceEntryState({
  revealDelayMs = 500,
}: {
  revealDelayMs?: number;
}) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), revealDelayMs);
    return () => window.clearTimeout(timer);
  }, [revealDelayMs]);

  return (
    <main
      className="bg-background text-foreground flex h-dvh items-center justify-center"
      role="status"
      aria-label="Loading workspace"
    >
      <SplashProgress
        className={`bg-foreground/10 [&>div]:bg-foreground/30 mt-0 transition-opacity duration-150 ${revealed ? "opacity-100" : "opacity-0"}`}
      />
    </main>
  );
}
