import type { ReactNode } from "react";

import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import { AppleLogo } from "./apple-logo";
import { GoogleLogo } from "./google-logo";

export function SocialProviderButton({
  className,
  disabled,
  loading,
  onClick,
  pressed,
  provider,
}: {
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  pressed?: boolean;
  provider: "apple" | "google";
}) {
  const apple = provider === "apple";
  return (
    <Button
      aria-pressed={
        pressed === undefined ? undefined : pressed ? "true" : "false"
      }
      className={cn(
        "h-11 w-full",
        apple
          ? "bg-black text-white hover:bg-neutral-900 hover:text-white hover:brightness-100"
          : "bg-white text-[#1f1f1f] hover:bg-neutral-100 hover:text-[#1f1f1f] hover:brightness-100",
        pressed &&
          "ring-foreground ring-offset-background ring-2 ring-offset-2",
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      {loading ? (
        <span
          aria-hidden
          className="mr-0.5 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : apple ? (
        <AppleLogo className="size-4" />
      ) : (
        <GoogleLogo className="size-4" />
      )}
      {apple ? "Sign in with Apple" : "Sign in with Google"}
    </Button>
  );
}

export function SocialProviderFields({ children }: { children: ReactNode }) {
  return <div className="mt-3 space-y-3 px-0.5">{children}</div>;
}
