"use client";

import { cn } from "@chief/ui/lib/utils";

import { usePlatform } from "./platform";

function AppleIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-[18px] shrink-0 fill-current"
      viewBox="0 0 24 24"
    >
      <path d="M18.7 19.5c-.8 1.2-1.7 2.4-3 2.5-1.4 0-1.8-.8-3.3-.8s-2 .8-3.3.8c-1.3 0-2.3-1.3-3.1-2.5C3.7 16 3 12.4 4.7 9.4c.9-1.5 2.4-2.5 4.1-2.5 1.3 0 2.5.9 3.3.9s2.3-1.1 3.8-.9c1.5.1 2.7.7 3.6 2-.1.1-2.2 1.3-2.1 3.8 0 3 2.6 4 2.7 4-.4 1-1 2-1.4 2.8M13 3.5c.7-.8 1.9-1.5 2.9-1.5.2 1.2-.3 2.4-1 3.2s-1.8 1.5-3 1.4c-.1-1.1.4-2.3 1.1-3.1z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-[16px] shrink-0 fill-current"
      viewBox="0 0 24 24"
    >
      <path d="M3 5.6 10.4 4.6v6.9H3V5.6Zm0 12.8 7.4 1v-6.8H3v5.8Zm8.6 1.2L21 21v-8.1h-9.4v6.7Zm0-15.2v7H21V3l-9.4 1.4Z" />
    </svg>
  );
}

export function DownloadButton({
  variant = "hero",
}: {
  variant?: "hero" | "page";
}) {
  const { os } = usePlatform();
  const isWindows = os === "windows";

  return (
    <a
      className={cn(
        "inline-flex touch-manipulation items-center justify-center gap-2.5 rounded-xl px-[22px] text-sm font-medium tracking-[-0.02em] whitespace-nowrap transition-opacity hover:opacity-90",
        variant === "hero" &&
          "h-[46px] rounded-lg bg-white text-neutral-950 shadow-[0_1px_2px_#0001]",
        variant === "page" && "bg-primary text-primary-foreground h-12",
      )}
      href={isWindows ? "/api/download/windows" : "/api/download/macos"}
    >
      {isWindows ? <WindowsIcon /> : <AppleIcon />}
      {isWindows ? "Download for Windows" : "Download for macOS"}
    </a>
  );
}
