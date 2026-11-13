import type { ReactNode } from "react";

import { cn } from "@chief/ui/lib/utils";

import type { AgentPresence } from "./chat/agent-profile-panel";

export const PRESENCE_COPY: Record<AgentPresence, string> = {
  working: "Working",
  error: "Last run failed",
  online: "Online",
  offline: "Offline",
};

export const PRESENCE_TONE: Record<AgentPresence, string> = {
  working: "bg-amber-400",
  error: "bg-red-500",
  online: "bg-emerald-500",
  offline: "bg-neutral-400 dark:bg-neutral-500",
};

/** An avatar with a presence dot on its corner; no dot when `presence` is null. */
export function WithPresence({
  children,
  presence,
  className,
  dotClassName,
}: {
  children: ReactNode;
  presence: AgentPresence | null;
  className?: string;
  /** Size and ring colour, which depend on the avatar and its background. */
  dotClassName?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {children}
      {presence ? (
        <span
          aria-label={PRESENCE_COPY[presence]}
          role="img"
          className={cn(
            "ring-background absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2",
            PRESENCE_TONE[presence],
            dotClassName,
          )}
        />
      ) : null}
    </span>
  );
}
