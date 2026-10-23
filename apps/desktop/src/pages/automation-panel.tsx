import type { ReactNode } from "react";
import { X } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

/**
 * The builder's property panel: dense rows, quiet filled controls and thin
 * section rules, so the canvas stays the loudest thing on screen.
 */
export const controlClass =
  "h-7 w-full min-w-0 rounded-[6px] border border-transparent bg-foreground/[0.045] px-2 text-[12px] leading-4 shadow-none outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-foreground/[0.08] focus:border-ring/50 focus:bg-background focus-visible:ring-0 disabled:opacity-50";

export const textAreaClass = cn(
  controlClass,
  "h-auto min-h-16 resize-y py-1.5 leading-[18px]",
);

export function Panel({
  icon,
  title,
  onTitleChange,
  eyebrow,
  onClose,
  footer,
  children,
}: {
  icon?: ReactNode;
  title: string;
  /** Makes the title editable in place. */
  onTitleChange?: (title: string) => void;
  eyebrow?: ReactNode;
  onClose?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside className="bg-background flex max-h-full w-[300px] flex-col overflow-hidden rounded-xl border border-black/[0.07] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.18)] dark:border-white/[0.08]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.055] pr-2 pl-3 dark:border-white/[0.06]">
        {icon ? (
          <span className="flex size-6 shrink-0 items-center justify-center">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="text-muted-foreground truncate text-[10px] leading-3">
              {eyebrow}
            </p>
          ) : null}
          {onTitleChange ? (
            <input
              aria-label="Step name"
              maxLength={120}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className="hover:bg-foreground/[0.045] focus:bg-foreground/[0.045] -ml-1 w-full truncate rounded-[5px] bg-transparent px-1 text-[13px] leading-5 font-medium tracking-[-0.01em] outline-none"
            />
          ) : (
            <h2 className="truncate text-[13px] leading-5 font-medium tracking-[-0.01em]">
              {title}
            </h2>
          )}
        </div>
        {onClose ? (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex size-7 shrink-0 items-center justify-center rounded-[6px]"
          >
            <X size={14} />
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer ? (
        <footer className="flex shrink-0 items-center border-t border-black/[0.055] px-2 py-1.5 dark:border-white/[0.06]">
          {footer}
        </footer>
      ) : null}
    </aside>
  );
}

export function PanelSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-2 border-b border-black/[0.055] px-3 py-3 last:border-b-0 dark:border-white/[0.06]",
        className,
      )}
    >
      {title || action ? (
        <div className="flex h-5 items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold tracking-[-0.005em]">
            {title}
          </h3>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A label beside a control, for short values. */
export function PanelRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-7 grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
      <span className="text-muted-foreground truncate text-[11px]">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A label above a control, for long values. */
export function Field({
  label,
  action,
  children,
  hint,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <p className="text-muted-foreground truncate text-[11px]">{label}</p>
        {action}
      </div>
      {children}
      {hint ? (
        <p
          title={hint}
          className="text-muted-foreground/90 line-clamp-1 text-[11px] leading-4"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Choice({
  label,
  value,
  onChange,
  children,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          controlClass,
          "justify-between gap-1.5 pr-1.5",
          className,
        )}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="rounded-lg text-[12px]">
        {children}
      </SelectContent>
    </Select>
  );
}

/** Two to four options that are all worth seeing at once. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="bg-foreground/[0.045] flex h-7 rounded-[7px] p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "text-muted-foreground hover:text-foreground flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[5px] text-[11px] font-medium transition-colors",
            value === option.value &&
              "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.06)] dark:bg-white/[0.1]",
          )}
        >
          {option.icon}
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
