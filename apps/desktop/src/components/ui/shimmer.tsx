"use client";

import type { CSSProperties } from "react";
import { memo, useMemo } from "react";
import { motion } from "motion/react";

import { cn } from "@chief/ui/lib/utils";

export interface ShimmerProps {
  as?: "h2" | "p" | "span";
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
}

/**
 * Vercel AI Elements-style text shimmer for concise in-progress labels.
 * The text keeps its inherited typography while a single linear highlight
 * travels across it, instead of swapping colors or layout between frames.
 */
function ShimmerComponent({
  as: Component = "p",
  children,
  className,
  duration = 2,
  spread = 2,
}: ShimmerProps) {
  const dynamicSpread = useMemo(
    () => Math.max(children.length * spread, 1),
    [children, spread],
  );
  const props = {
    animate: { backgroundPosition: "0% center" },
    className: cn(
      "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
      "[background-repeat:no-repeat,padding-box] [--shimmer-bg:linear-gradient(90deg,#0000_calc(50%-var(--shimmer-spread)),var(--background),#0000_calc(50%+var(--shimmer-spread)))]",
      className,
    ),
    initial: { backgroundPosition: "100% center" },
    style: {
      "--shimmer-spread": `${dynamicSpread}px`,
      backgroundImage:
        "var(--shimmer-bg), linear-gradient(var(--muted-foreground), var(--muted-foreground))",
    } as CSSProperties,
    transition: {
      duration,
      ease: "linear" as const,
      repeat: Number.POSITIVE_INFINITY,
    },
  };

  if (Component === "h2") return <motion.h2 {...props}>{children}</motion.h2>;
  if (Component === "span") {
    return <motion.span {...props}>{children}</motion.span>;
  }
  return <motion.p {...props}>{children}</motion.p>;
}

export const Shimmer = memo(ShimmerComponent);
