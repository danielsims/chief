import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@chief/ui/lib/utils";

/** A page's single column of rows, as automations, projects and agents list. */
export const listColumnClass = "mx-auto w-full max-w-2xl pt-6";

const rowClass =
  "hover:bg-accent/50 -mx-3 flex w-[calc(100%+24px)] items-center gap-4 rounded-lg px-3 py-2.5 text-left transition-colors";

/** One row: what it is, a line about it, and what's on the right. */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  to,
  onClick,
  onHover,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  /** Called when the pointer arrives, to start loading what it opens. */
  onHover?: () => void;
  className?: string;
}) {
  const content = (
    <>
      {leading ? <span className="flex shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">
          {title}
        </span>
        {subtitle ? (
          <span className="text-muted-foreground block truncate text-[12px]">
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing}
    </>
  );
  return (
    <li>
      {to ? (
        <Link
          to={to}
          className={cn(rowClass, className)}
          onPointerEnter={onHover}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          onPointerEnter={onHover}
          className={cn(rowClass, className)}
        >
          {content}
        </button>
      )}
    </li>
  );
}
