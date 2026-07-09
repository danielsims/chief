import * as React from "react";
import { cn } from "../lib/utils";

/**
 * Strip a raw social handle down to its bare form: drops protocol and www,
 * a pasted copy of the prefix itself (e.g. "x.com/acme"), leading @ and
 * slashes, and any query/fragment/trailing slashes.
 */
export function sanitizeHandle(raw: string, prefix?: string): string {
  let value = raw.trim();
  value = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (prefix) {
    const bare = prefix.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    if (bare && value.toLowerCase().startsWith(bare.toLowerCase())) {
      value = value.slice(bare.length);
    }
  }
  value = value.replace(/^[@/]+/, "");
  value = value.split("?")[0]?.split("#")[0] ?? "";
  return value.replace(/\/+$/, "");
}

export interface PrefixedInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "prefix" | "value" | "onChange"
  > {
  /** Fixed label rendered left of the input, e.g. "x.com/". */
  prefix: string;
  value: string;
  /** Receives the sanitized handle on every change. */
  onValueChange: (handle: string) => void;
}

/**
 * Fixed-prefix input for social handles: the platform prefix sits in a
 * muted, bordered cell on the left; the right side only ever holds the bare
 * handle. Full-URL pastes and leading @/slashes are stripped on input.
 */
export const PrefixedInput = React.forwardRef<
  HTMLInputElement,
  PrefixedInputProps
>(({ className, prefix, value, onValueChange, ...props }, ref) => {
  return (
    <div
      className={cn(
        "flex h-9 w-full border bg-transparent text-sm transition-colors focus-within:border-ring",
        className,
      )}
    >
      <span className="flex select-none items-center border-r bg-muted px-3 text-muted-foreground">
        {prefix}
      </span>
      <input
        ref={ref}
        type="text"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent px-3 py-1 placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        onChange={(event) =>
          onValueChange(sanitizeHandle(event.target.value, prefix))
        }
        {...props}
      />
    </div>
  );
});
PrefixedInput.displayName = "PrefixedInput";
