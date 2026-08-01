"use client";

import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  "focus-visible:ring-ring/30 focus-visible:ring-offset-background relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color,transform] duration-150 outline-none before:pointer-events-none before:absolute before:inset-px before:rounded-[7px] before:bg-gradient-to-b before:from-white/[0.07] before:via-white/[0.02] before:to-transparent focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary/85 from-primary to-primary/95 text-primary-foreground bg-gradient-to-b shadow-[0_1px_2px_hsl(0_0%_0%/0.16),inset_0_1px_hsl(0_0%_100%/0.12)] hover:brightness-[1.04] active:shadow-[inset_0_1px_1px_hsl(0_0%_0%/0.14)]",
        destructive:
          "border-destructive/85 from-destructive to-destructive/92 bg-gradient-to-b text-white shadow-[0_1px_2px_hsl(0_0%_0%/0.14),inset_0_1px_hsl(0_0%_100%/0.14)] hover:brightness-[1.03] active:shadow-[inset_0_1px_1px_hsl(0_0%_0%/0.14)]",
        "destructive-outline":
          "border-input/80 from-popover to-muted/45 text-destructive-foreground hover:border-destructive/30 hover:to-destructive/[0.06] bg-gradient-to-b shadow-[0_1px_2px_hsl(0_0%_0%/0.05),inset_0_1px_hsl(0_0%_100%/0.45)] dark:from-white/[0.055] dark:to-white/[0.025] dark:shadow-[0_1px_2px_hsl(0_0%_0%/0.24),inset_0_1px_hsl(0_0%_100%/0.06)]",
        outline:
          "border-input/80 from-popover to-muted/45 text-foreground hover:from-accent/80 hover:to-accent/50 bg-gradient-to-b shadow-[0_1px_2px_hsl(0_0%_0%/0.05),inset_0_1px_hsl(0_0%_100%/0.45)] dark:from-white/[0.055] dark:to-white/[0.025] dark:shadow-[0_1px_2px_hsl(0_0%_0%/0.24),inset_0_1px_hsl(0_0%_100%/0.06)] dark:hover:from-white/[0.075] dark:hover:to-white/[0.04]",
        secondary:
          "from-secondary to-secondary/88 text-secondary-foreground border-transparent bg-gradient-to-b shadow-[inset_0_1px_hsl(0_0%_100%/0.08)] hover:brightness-[1.03]",
        ghost:
          "text-foreground hover:bg-accent active:bg-accent border-transparent bg-transparent shadow-none before:hidden",
        link: "text-foreground border-transparent bg-transparent shadow-none before:hidden hover:underline hover:underline-offset-4 active:translate-y-0",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 gap-1.5 px-2.5 text-xs",
        lg: "h-10 px-3.5",
        xs: "h-7 gap-1 rounded-md px-2 text-xs before:rounded-[5px]",
        icon: "size-9 px-0",
        "icon-sm": "size-8 px-0",
        "icon-xs": "size-7 rounded-md px-0 before:rounded-[5px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  render,
  children,
  loading = false,
  disabled: disabledProp,
  ...props
}: ButtonProps): React.ReactElement {
  const disabled = Boolean(loading || disabledProp);
  const type: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    "aria-disabled": loading || undefined,
    children: (
      <>
        {children}
        {loading ? (
          <LoaderCircle
            aria-hidden
            className="absolute size-4 animate-spin"
            data-slot="button-loading-indicator"
          />
        ) : null}
      </>
    ),
    className: cn(buttonVariants({ className, size, variant })),
    "data-loading": loading ? "" : undefined,
    "data-slot": "button",
    disabled,
    type,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export { buttonVariants };
