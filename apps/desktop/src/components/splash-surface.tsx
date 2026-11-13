import type { ReactNode } from "react";

import { cn } from "@chief/ui/lib/utils";

import { ChiefMark } from "./chief-mark";

const skyUrl = "/splash-sky.webp";

/**
 * The sky surface shared by every pre-app screen. The mark sits at the same
 * point in launch, sign-in and workspace loading, so moving between them reads
 * as one surface changing state rather than three screens.
 */
export function SplashSurface({
  children,
  chrome,
  className,
  ...props
}: {
  children?: ReactNode;
  /** Controls pinned to the top-right of the window chrome. */
  chrome?: ReactNode;
  className?: string;
  role?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      {...props}
      className={cn(
        "relative isolate flex h-dvh min-h-screen flex-col overflow-hidden bg-[#2a1d2c] text-white",
        className,
      )}
    >
      <img
        alt=""
        aria-hidden="true"
        className="splash-sky pointer-events-none absolute inset-0 -z-20 size-full object-cover select-none"
        decoding="async"
        draggable={false}
        src={skyUrl}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_62%_58%_at_50%_46%,rgba(16,12,28,0.5),rgba(16,12,28,0.14)_70%),linear-gradient(to_bottom,rgba(16,12,28,0.3),rgba(16,12,28,0)_24%,rgba(16,12,28,0)_62%,rgba(16,12,28,0.42))]"
      />

      <header data-tauri-drag-region className="h-16 shrink-0">
        {chrome ? (
          <div
            className="absolute top-7 right-4 z-10"
            data-tauri-drag-region="false"
          >
            {chrome}
          </div>
        ) : null}
      </header>

      <main className="flex flex-1 items-center justify-center px-8 pb-16">
        <div className="flex w-full max-w-[19rem] flex-col items-center text-center">
          <ChiefMark className="h-11 w-11 text-white drop-shadow-[0_2px_14px_rgba(16,12,28,0.45)]" />
          <div className="flex h-60 w-full flex-col items-center">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

/** A hairline sweep under the mark: present, never demanding. */
export function SplashProgress({ className }: { className?: string }) {
  return (
    <div
      className={cn("mt-8 h-px w-24 overflow-hidden bg-white/25", className)}
    >
      <div className="entry-progress h-full w-1/3 bg-white/85" />
    </div>
  );
}

export const splashPrimaryButtonClass =
  "bg-white text-[#17121d] shadow-[0_1px_2px_rgba(16,12,28,0.2),0_10px_30px_-10px_rgba(16,12,28,0.55)] hover:bg-white/92 hover:brightness-100 active:shadow-[0_1px_2px_rgba(16,12,28,0.2)] focus-visible:ring-white/70 focus-visible:ring-offset-0 disabled:bg-white/85 disabled:opacity-100 disabled:text-[#17121d]/60";

export const splashGhostButtonClass =
  "bg-white/5 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)] backdrop-blur-sm hover:bg-white/14 active:bg-white/14 focus-visible:ring-white/70 focus-visible:ring-offset-0 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)]";
