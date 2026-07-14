"use client";

import { useEffect, useState } from "react";

type Platform = "macos" | "windows";

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
] satisfies {
  id: Platform;
  name: string;
  description: string;
  detail: string;
  href: string;
  label: string;
  icon: () => React.ReactNode;
}[];

function detectPlatform(): Platform | null {
  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes("windows")) return "windows";
  if (userAgent.includes("macintosh") || userAgent.includes("mac os")) {
    return "macos";
  }

  return null;
}

export function DownloadOptions() {
  const [preferredPlatform, setPreferredPlatform] = useState<Platform | null>(
    null,
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPreferredPlatform(detectPlatform());
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="download-grid">
      {options.map((option) => {
        const isPreferred = option.id === preferredPlatform;
        const PlatformIcon = option.icon;

        return (
          <article key={option.id}>
            <span className="download-icon">
              <PlatformIcon />
            </span>
            <h2>{option.name}</h2>
            <p>{option.description}</p>
            <small>{option.detail}</small>
            <a
              className={isPreferred ? "preferred-download" : undefined}
              href={option.href}
            >
              {option.label}
              <PlatformIcon />
            </a>
          </article>
        );
      })}
    </div>
  );
}
