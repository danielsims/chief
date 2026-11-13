import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { CheckBadge } from "./check-badge";

/** Full-width main action, as in Chief's own setup. */
export const handoffPrimaryClassName =
  "bg-foreground text-background mt-7 flex h-[39px] w-full items-center justify-center rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50";

/** A quiet text action under the main one. */
export const handoffSecondaryClassName =
  "text-muted-foreground hover:text-foreground mt-3 flex h-9 w-full items-center justify-center text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-50";

/**
 * A browser page that hands someone back to Chief: sign-in, billing and
 * invitations. It reads like a step of Chief's own setup, set in a card.
 */
export function HandoffCard({
  brand,
  children,
}: {
  brand: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="bg-background text-foreground flex min-h-screen w-full items-center justify-center px-4 py-16">
      <div className="bg-card w-full max-w-[420px] rounded-2xl p-8 shadow-[0_0_0_1px_var(--border),0_12px_32px_-16px_rgba(0,0,0,0.35)]">
        <div className="mb-9 [&>*]:size-6">{brand}</div>
        {children}
      </div>
    </main>
  );
}

export function HandoffHeading({
  title,
  done = false,
  children,
}: {
  title: ReactNode;
  /** A small check beside the title once the step is complete. */
  done?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        {done ? <CheckBadge /> : null}
        <h1 className="text-[21px] leading-tight font-[550] tracking-[-0.035em]">
          {title}
        </h1>
      </div>
      {children ? (
        <p className="text-muted-foreground mt-2.5 text-sm leading-relaxed">
          {children}
        </p>
      ) : null}
    </>
  );
}

/** The workspace someone is joining: its icon, name and what they're invited to. */
export function HandoffWorkspace({
  icon,
  name,
  detail,
}: {
  icon: ReactNode;
  name: string;
  detail?: ReactNode;
}) {
  return (
    <div className="bg-background/60 mt-6 flex items-center gap-3 rounded-xl p-3 shadow-[0_0_0_1px_var(--border)]">
      {icon}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        {detail ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A note under the actions, such as an error. */
export function HandoffNote({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "error";
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "mt-4 text-[13px] leading-5",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}
