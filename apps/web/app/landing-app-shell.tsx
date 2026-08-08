import type { ReactNode } from "react";
import Image from "next/image";

import { BrandMark } from "./brand-mark";

type ShellIconName =
  | "agents"
  | "analytics"
  | "back"
  | "calendar"
  | "files"
  | "forward"
  | "overview"
  | "search"
  | "sidebar";

const iconPaths: Record<ShellIconName, ReactNode> = {
  agents: (
    <>
      <circle cx="12" cy="6" r="2.5" />
      <circle cx="5.5" cy="18" r="2.5" />
      <circle cx="18.5" cy="18" r="2.5" />
      <path d="M12 8.5v4M5.5 15.5v-3h13v3" />
    </>
  ),
  analytics: <path d="M5 19V9m5 10V5m5 14v-7m4 7H3" />,
  back: <path d="m14 7-5 5 5 5" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4m8-4v4M4 10h16" />
      <circle cx="12" cy="15" r="2.5" />
    </>
  ),
  files: (
    <>
      <path d="M4 6h6l2 3h8v10H4z" />
      <path d="M4 11h16" />
    </>
  ),
  forward: <path d="m10 7 5 5-5 5" />,
  overview: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  sidebar: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M9 5v14" />
    </>
  ),
};

export function LandingShellIcon({
  name,
  size = 15,
}: {
  name: ShellIconName;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
    >
      {iconPaths[name]}
    </svg>
  );
}

const navigation = [
  ["Overview", "overview"],
  ["Schedule", "calendar"],
  ["Agents", "agents"],
  ["Analytics", "analytics"],
  ["Files", "files"],
] as const;

export function LandingAppShell({
  activeNav,
  children,
  label,
}: {
  activeNav: (typeof navigation)[number][0];
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="landing-app-shell" role="img" aria-label={label}>
      <aside className="landing-app-rail" aria-hidden="true">
        <span className="landing-app-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="landing-app-workspace chief-workspace active">
          <BrandMark size={13} tone="black" />
        </span>
        <span className="landing-app-workspace program-workspace">
          <i />
        </span>
        <span className="landing-app-workspace studio-workspace">
          <i />
        </span>
      </aside>

      <div className="landing-app-chrome" aria-hidden="true">
        <LandingShellIcon name="sidebar" size={14} />
        <LandingShellIcon name="back" size={14} />
        <span className="disabled">
          <LandingShellIcon name="forward" size={14} />
        </span>
      </div>

      <aside className="landing-app-sidebar" aria-hidden="true">
        <div className="landing-app-search">
          <LandingShellIcon name="search" size={13} />
          <span>Search Chief</span>
          <kbd>⌘K</kbd>
        </div>
        <nav className="landing-app-navigation">
          {navigation.map(([name, icon]) => (
            <span
              className={name === activeNav ? "active" : undefined}
              key={name}
            >
              <LandingShellIcon name={icon} size={14} />
              {name}
            </span>
          ))}
        </nav>
        <div className="landing-app-sidebar-group">
          <small>Channels</small>
          <span># &nbsp;getting-started</span>
          <span># &nbsp;engineering</span>
          <span># &nbsp;analytics</span>
          <span># &nbsp;research</span>
          <span># &nbsp;general</span>
        </div>
        <div className="landing-app-sidebar-group landing-agent-group">
          <small>Direct messages</small>
          <span>
            <i className="engineer-dot" /> Engineer
          </span>
          <span>
            <i className="marketer-dot" /> Marketer
          </span>
          <span>
            <i className="research-dot" /> Researcher
          </span>
          <span>
            <i className="analyst-dot" /> Analyst
          </span>
        </div>
        <div className="landing-app-profile">
          <Image
            src="/people/sophie-hart-avatar.png"
            alt=""
            width={34}
            height={34}
            sizes="34px"
          />
          <span>
            <strong>Sophie Hart</strong>
            <small>sophie@northstar.studio</small>
          </span>
          <b>⌃</b>
        </div>
      </aside>

      <section className="landing-app-surface">{children}</section>
    </div>
  );
}
