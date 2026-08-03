import type { ReactNode } from "react";

import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

export function Chip({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "hover:border-foreground inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
        selected
          ? "border-foreground bg-accent text-foreground"
          : "bg-background text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function StepFrame({
  children,
  onContinue,
  disabled,
  saving,
  continueLabel = "Continue",
  actionsLeft,
  actionsAlign = "left",
}: {
  children: ReactNode;
  onContinue: () => void;
  disabled?: boolean;
  saving?: boolean;
  continueLabel?: string;
  actionsLeft?: ReactNode;
  actionsAlign?: "left" | "right";
}) {
  return (
    <div className="bg-card/60 w-full rounded-xl border p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      {children}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div
          className={cn(
            "flex flex-wrap items-center gap-2",
            actionsAlign === "right" && "ml-auto",
          )}
        >
          {actionsLeft}
        </div>
        <Button
          type="button"
          onClick={() => void onContinue()}
          disabled={disabled === true || saving === true}
        >
          {saving ? "Saving..." : continueLabel}
        </Button>
      </div>
    </div>
  );
}
