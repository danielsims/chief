"use client";

import { cn } from "@chief/ui/lib/utils";

import { usePlatform } from "../platform";

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M0 3.449 9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  );
}

const options = [
  {
    id: "macos",
    name: "macOS",
    description: "The desktop workspace for Apple silicon Macs.",
    detail: "Apple silicon · macOS 12 or later",
    href: "/api/download/macos",
    label: "Download for macOS",
    icon: AppleIcon,
  },
  {
    id: "windows",
    name: "Windows",
    description: "The desktop workspace for Windows PCs.",
    detail: "Windows 10 or later",
    href: "/api/download/windows",
    label: "Download for Windows",
    icon: WindowsIcon,
  },
] as const;

export function DownloadOptions() {
  const { os } = usePlatform();

  return (
    <div className="mt-14 grid gap-4 md:grid-cols-2">
      {options.map((option) => {
        const isPreferred = os === option.id;
        const Icon = option.icon;

        return (
          <article
            className="bg-card flex flex-col rounded-3xl p-7 md:p-8"
            key={option.id}
          >
            <Icon className="text-foreground size-9 max-md:size-8" />
            <h2 className="text-foreground mt-6 text-xl font-medium tracking-[-0.03em]">
              {option.name}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-[1.55]">
              {option.description}
            </p>
            <small className="text-muted-foreground mt-1 text-xs">
              {option.detail}
            </small>
            <a
              className={cn(
                "mt-7 inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl px-[22px] text-sm font-medium tracking-[-0.02em] transition-opacity hover:opacity-90",
                isPreferred
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground shadow-[inset_0_0_0_1px_var(--border)]",
              )}
              href={option.href}
            >
              {option.label}
            </a>
          </article>
        );
      })}
    </div>
  );
}
