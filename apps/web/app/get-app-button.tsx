"use client";

import Link from "next/link";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/base-popover";
import { cn } from "@chief/ui/lib/utils";

import { usePlatform } from "./platform";

export function GetAppButton() {
  const platform = usePlatform();

  return (
    <Popover>
      <PopoverTrigger className="bg-primary text-primary-foreground inline-flex h-12 touch-manipulation items-center justify-center gap-2.5 rounded-xl px-[22px] text-sm font-medium tracking-[-0.02em] whitespace-nowrap transition-opacity hover:opacity-90">
        Get the app
        <svg
          aria-hidden="true"
          className="size-3 fill-current"
          viewBox="0 0 12 12"
        >
          <path d="M2.15 4.22a.75.75 0 0 1 1.06.03L6 7.2l2.79-2.95a.75.75 0 1 1 1.09 1.03L6.55 8.78a.75.75 0 0 1-1.1 0L2.12 5.28a.75.75 0 0 1 .03-1.06z" />
        </svg>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="min-w-[228px] bg-[#161616] p-1.5 text-[#f4f4f4] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_18px_40px_rgba(0,0,0,0.28)]"
        side="bottom"
      >
        <Link
          className={cn(
            "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium tracking-[-0.02em] text-inherit hover:bg-white/8",
            platform.preferred === "desktop" && "bg-white/8",
          )}
          href={platform.desktopHref}
        >
          <svg
            aria-hidden="true"
            className="size-[18px] shrink-0"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
          >
            <rect height="13" rx="2.2" width="18" x="3" y="4" />
            <path d="M8 20h8M12 17v3" />
          </svg>
          <span className="flex flex-col gap-px">
            Desktop
            <small className="text-xs font-normal tracking-normal text-white/50">
              {platform.desktopHint}
            </small>
          </span>
        </Link>
        <Link
          className={cn(
            "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium tracking-[-0.02em] text-inherit hover:bg-white/8",
            platform.preferred === "ios" && "bg-white/8",
          )}
          href="/download"
        >
          <svg
            aria-hidden="true"
            className="size-[18px] shrink-0 fill-current"
            viewBox="0 0 24 24"
          >
            <path d="M18.7 19.5c-.8 1.2-1.7 2.4-3 2.5-1.4 0-1.8-.8-3.3-.8s-2 .8-3.3.8c-1.3 0-2.3-1.3-3.1-2.5C3.7 16 3 12.4 4.7 9.4c.9-1.5 2.4-2.5 4.1-2.5 1.3 0 2.5.9 3.3.9s2.3-1.1 3.8-.9c1.5.1 2.7.7 3.6 2-.1.1-2.2 1.3-2.1 3.8 0 3 2.6 4 2.7 4-.4 1-1 2-1.4 2.8M13 3.5c.7-.8 1.9-1.5 2.9-1.5.2 1.2-.3 2.4-1 3.2s-1.8 1.5-3 1.4c-.1-1.1.4-2.3 1.1-3.1z" />
          </svg>
          <span className="flex flex-col gap-px">
            iOS
            {platform.iosHint ? (
              <small className="text-xs font-normal tracking-normal text-white/50">
                {platform.iosHint}
              </small>
            ) : null}
          </span>
        </Link>
      </PopoverContent>
    </Popover>
  );
}
