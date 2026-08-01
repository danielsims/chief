import { cn } from "@chief/ui/lib/utils";

import { ChiefMark } from "./chief-mark";

export function AgentAvatar({
  className,
  label = "Chief agent",
  markClassName,
}: {
  className?: string;
  label?: string;
  markClassName?: string;
}) {
  return (
    <span
      className={cn(
        "bg-foreground text-background inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--background)_12%,transparent),inset_0_1px_color-mix(in_srgb,var(--background)_10%,transparent)]",
        className,
      )}
    >
      <ChiefMark className={cn("size-1/2", markClassName)} title={label} />
    </span>
  );
}
