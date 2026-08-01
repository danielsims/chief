import type { ReactNode } from "react";

import { cn } from "@chief/ui/lib/utils";

export function PageTitle({
  children,
  size = "page",
}: {
  children: ReactNode;
  size?: "overview" | "page";
}) {
  return (
    <h1
      className={cn(
        "m-0 leading-[1.08] font-normal tracking-[-0.04em]",
        size === "overview"
          ? "text-[clamp(25px,3vw,36px)]"
          : "text-[clamp(24px,2.4vw,30px)]",
      )}
    >
      {children}
    </h1>
  );
}
