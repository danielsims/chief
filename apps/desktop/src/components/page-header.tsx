import type { ReactNode } from "react";

import { cn } from "@chief/ui/lib/utils";

import { PageTitle } from "./page-title";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("shrink-0 px-6 py-5", className)}>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <PageTitle>{title}</PageTitle>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {description ? (
        <p className="text-muted-foreground mt-1 text-[13px] leading-5 font-normal">
          {description}
        </p>
      ) : null}
    </header>
  );
}
