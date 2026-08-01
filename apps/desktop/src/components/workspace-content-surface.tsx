import type { ReactNode } from "react";

import { cn } from "@chief/ui/lib/utils";

/** The single inset content frame shared by every authenticated workspace route. */
export function WorkspaceContentSurface({
  children,
  balancedGutter = false,
}: {
  children: ReactNode;
  balancedGutter?: boolean;
}) {
  return (
    <main
      className={cn(
        "bg-background relative isolate z-10 mt-px mr-2 mb-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.045)] after:pointer-events-none after:absolute after:inset-0 after:z-50 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.22)] dark:after:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]",
        balancedGutter ? "ml-2" : "ml-px",
      )}
    >
      {children}
    </main>
  );
}
