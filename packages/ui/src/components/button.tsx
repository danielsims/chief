"use client";

import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  "focus-visible:ring-ring/30 focus-visible:ring-offset-background relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border-0 text-sm font-medium whitespace-nowrap transition-[background-color,box-shadow,color,transform] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_88%,black),inset_0_1px_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.12)] hover:brightness-[1.025] active:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_88%,black),inset_0_1px_1px_rgba(0,0,0,0.12)]",
        destructive:
          "bg-destructive text-white shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--destructive)_86%,black),inset_0_1px_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.1)] hover:brightness-[1.025]",
        "destructive-outline":
          "bg-popover text-destructive-foreground hover:bg-destructive/[0.05] shadow-[inset_0_0_0_1px_var(--input),inset_0_1px_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_0_0_1px_var(--input),inset_0_1px_rgba(255,255,255,0.035),0_1px_2px_rgba(0,0,0,0.18)]",
        outline:
          "bg-popover text-foreground hover:bg-accent shadow-[inset_0_0_0_1px_var(--input),inset_0_1px_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[inset_0_0_0_1px_var(--input),inset_0_1px_rgba(255,255,255,0.035),0_1px_2px_rgba(0,0,0,0.18)]",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[inset_0_1px_rgba(255,255,255,0.05)] hover:brightness-[1.025]",
        ghost:
          "text-foreground hover:bg-accent active:bg-accent bg-transparent shadow-none",
        link: "text-foreground bg-transparent shadow-none hover:underline hover:underline-offset-4 active:translate-y-0",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 gap-1.5 px-2.5 text-xs",
        lg: "h-10 px-3.5",
        xs: "h-7 gap-1 rounded-md px-2 text-xs",
        icon: "size-9 px-0",
        "icon-sm": "size-8 px-0",
        "icon-xs": "size-7 rounded-md px-0",
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
    "aria-busy": loading || undefined,
    "aria-disabled": loading || undefined,
    children: (
      <>
        <span
          aria-hidden={loading || undefined}
          className={cn(
            "inline-flex items-center gap-[inherit]",
            loading && "invisible",
          )}
          data-slot="button-content"
        >
          {children}
        </span>
        {loading ? (
          <>
            <LoaderCircle
              aria-hidden
              className="absolute size-4 animate-spin"
              data-slot="button-loading-indicator"
            />
            <span className="sr-only">Loading</span>
          </>
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
