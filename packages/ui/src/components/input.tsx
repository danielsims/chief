import * as React from "react";

import { cn } from "../lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "placeholder:text-muted-foreground focus-visible:border-ring/35 focus-visible:ring-ring/15 flex h-9 w-full rounded-lg border bg-transparent px-3 py-1 text-sm shadow-[inset_0_1px_1px_hsl(0_0%_0%/0.03)] transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";
