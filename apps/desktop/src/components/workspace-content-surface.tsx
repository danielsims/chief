import type { ReactNode } from "react";

import { cn } from "@chief/ui/lib/utils";

/** The raised, rounded card every workspace surface sits on. */
export const workspaceCardClassName =
  "bg-background relative isolate overflow-hidden rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.045)] after:pointer-events-none after:absolute after:inset-0 after:z-50 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] after:content-[''] dark:shadow-[0_1px_4px_rgba(0,0,0,0.22)] dark:after:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]";

/** The single inset content frame shared by every authenticated workspace route.
 * `split` leaves the framing to the page, which lays out several cards. */
export function WorkspaceContentSurface({
  children,
  balancedGutter = false,
  split = false,
}: {
  children: ReactNode;
  balancedGutter?: boolean;
  split?: boolean;
}) {
  return (
    <main
      className={cn(
        "relative z-10 mt-px mr-2 mb-2 flex min-h-0 min-w-0 flex-1 flex-col",
        split ? "overflow-visible" : workspaceCardClassName,
        balancedGutter ? "ml-2" : "ml-px",
      )}
    >
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          !split && "bg-background overflow-hidden rounded-[inherit]",
        )}
      >
        {children}
      </div>
    </main>
  );
}
