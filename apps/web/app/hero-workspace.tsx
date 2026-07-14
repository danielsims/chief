"use client";

import { useEffect, useState, type ReactNode } from "react";

import { BrandMark } from "./brand-mark";

type IconName =
  | "grid"
  | "messages"
  | "network"
  | "calendar"
  | "chart"
  | "megaphone"
  | "users"
  | "flame"
  | "settings"
  | "bell"
  | "arrow";

interface DemoEvent {
  id: string;
  agent: string;
  title: string;
  body: string;
  actionIncrease: number;
  dashboard: {
    actionItems: string;
    actionDetail: string;
    traffic: string;
    trafficTrend?: string;
    trafficDetail: string;
    signups: string;
    signupDetail: string;
    prospects: string;
    prospectDetail: string;
    scheduled: string;
    scheduledDetail: string;
  };
}

const baseDashboard = {
  actionItems: "0",
  actionDetail: "Nothing flagged by agents",
  traffic: "84.2K",
  trafficDetail: "214K page views · 30 D",
  signups: "2,641",
  signupDetail: "Tracked conversions · 30 D",
  prospects: "186",
  prospectDetail: "Ready to review",
  scheduled: "42",
  scheduledDetail: "Upcoming content",
};

const demoEvents: DemoEvent[] = [
  {
    id: "buying-signals",
    agent: "Prospector",
    title: "5 strong buying signals found",
    body: "Qualified prospects are ready with source evidence and outreach angles.",
    actionIncrease: 1,
    dashboard: {
      ...baseDashboard,
      actionDetail: "Prospect review ready",
      prospects: "191",
      prospectDetail: "5 new buying signals",
    },
  },
  {
    id: "campaign-draft",
    agent: "Ads Manager",
    title: "Your first ad campaign is ready",
    body: "Audience, budget and conversion goal are set. The draft is ready for review.",
    actionIncrease: 1,
    dashboard: {
      ...baseDashboard,
      actionItems: "1",
      actionDetail: "Campaign draft ready",
    },
  },
  {
    id: "conversion-leak",
    agent: "Analyst",
    title: "The biggest signup leak is clear",
    body: "One measurable experiment is ready to recover lost conversions.",
    actionIncrease: 1,
    dashboard: {
      ...baseDashboard,
      actionItems: "1",
      actionDetail: "Conversion experiment ready",
      signupDetail: "Funnel leak identified",
    },
  },
  {
    id: "launch-content",
    agent: "Content writer",
    title: "3 launch posts are ready",
    body: "LinkedIn, Instagram and TikTok drafts are waiting for review.",
    actionIncrease: 1,
    dashboard: {
      ...baseDashboard,
      actionDetail: "Content approval ready",
      scheduled: "45",
      scheduledDetail: "3 new drafts ready",
    },
  },
  {
    id: "campaign-watch",
    agent: "Ads Manager",
    title: "Wasted spend caught early",
    body: "One campaign is spending without converting. A safe adjustment is ready.",
    actionIncrease: 0,
    dashboard: {
      ...baseDashboard,
      actionItems: "1",
      actionDetail: "Campaign adjustment ready",
    },
  },
  {
    id: "growth-report",
    agent: "Analyst",
    title: "Signups are up 18%",
    body: "The lift is concentrated in the launch campaign. The next action is ready.",
    actionIncrease: 1,
    dashboard: {
      ...baseDashboard,
      actionItems: "1",
      actionDetail: "Growth report ready",
      traffic: "96.8K",
      trafficTrend: "↗ 15.0%",
      trafficDetail: "248K page views · 30 D",
      signups: "3,116",
      signupDetail: "Up 18% · 30 D",
    },
  },
];

const railIcons: IconName[] = [
  "grid",
  "messages",
  "network",
  "calendar",
  "chart",
  "megaphone",
  "users",
  "flame",
];

function HeroIcon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </>
    ),
    messages: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-7a4 4 0 0 1-1-2.6V7a4 4 0 0 1 4-4h7" />
        <path d="M15 5h4a3 3 0 0 1 3 3v7l-3-2h-4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" />
      </>
    ),
    network: (
      <>
        <rect x="9" y="2" width="6" height="6" />
        <rect x="2" y="16" width="6" height="6" />
        <rect x="16" y="16" width="6" height="6" />
        <path d="M12 8v4M5 16v-2h14v2" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" />
        <path d="M16 3v4M8 3v4M3 10h18" />
        <circle cx="12" cy="15" r="3" />
        <path d="M12 13.5V15l1 1" />
      </>
    ),
    chart: (
      <>
        <path d="M3 3v18h18" />
        <path d="m7 15 4-4 3 2 5-6" />
      </>
    ),
    megaphone: (
      <>
        <path d="m3 11 16-7v16L3 13v-2Z" />
        <path d="M6 14v5a2 2 0 0 0 2 2h2v-5" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M17 15a6 6 0 0 1 5 6" />
      </>
    ),
    flame: (
      <path d="M12 22c4.4 0 8-3.4 8-7.7 0-3.3-1.8-6.5-5.2-9.7.2 3.1-1.5 5.1-3 6.1.2-3.8-2.1-6.8-4.5-8.7.2 4-3.3 6.5-3.3 11.9C4 18.4 7.6 22 12 22Z" />
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    arrow: (
      <>
        <path d="M12 19V5M6 11l6-6 6 6" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function MetricCard({ children }: { children: ReactNode }) {
  return <div className="hero-metric">{children}</div>;
}

export function HeroWorkspace() {
  const [demo, setDemo] = useState({
    eventIndex: 0,
    actionCount: demoEvents[0]!.actionIncrease,
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDemo((current) => {
        const eventIndex = (current.eventIndex + 1) % demoEvents.length;
        return {
          eventIndex,
          actionCount: Math.min(
            4,
            current.actionCount + demoEvents[eventIndex]!.actionIncrease,
          ),
        };
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const event = demoEvents[demo.eventIndex]!;
  const dashboard = event.dashboard;

  return (
    <div
      className={`hero-workspace event-${event.id}`}
      role="img"
      aria-label="Chief desktop workspace showing proactive specialist agents returning marketing results for review"
    >
      <aside className="hero-app-rail">
        <div className="hero-window-strip">
          <span className="hero-window-dots">
            <i />
            <i />
            <i />
          </span>
          <BrandMark className="hero-rail-mark" size={20} />
        </div>
        <nav aria-hidden="true">
          {railIcons.map((icon, index) => (
            <span className={index === 0 ? "active" : ""} key={icon}>
              <HeroIcon name={icon} />
            </span>
          ))}
        </nav>
        <div className="hero-rail-footer">
          <span className="hero-org-mark">
            <i />
          </span>
          <span>
            <HeroIcon name="settings" />
          </span>
        </div>
      </aside>

      <div className="hero-app-main">
        <header className="hero-app-header">
          <span className="hero-run-state">runtime</span>
          <span className="hero-app-bell">
            <HeroIcon name="bell" size={15} />
            <i className="visible" />
          </span>
        </header>

        <div className="hero-dashboard">
          <div className="hero-dashboard-heading">
            <div className="hero-workspace-indicator">
              <span>
                <i />
              </span>
              <small>Program</small>
            </div>
            <h2>
              Good morning<span>, Sam</span>
            </h2>
            <p>An overview of your channels and agents.</p>
          </div>

          <div className="hero-metrics">
            <MetricCard>
              <span>
                Action items
                <i className="hero-attention-dot" />
              </span>
              <strong>{demo.actionCount}</strong>
              <small>{dashboard.actionDetail}</small>
            </MetricCard>
            <MetricCard>
              <span>Website traffic</span>
              <div>
                <strong>{dashboard.traffic}</strong>
                {dashboard.trafficTrend ? (
                  <b>{dashboard.trafficTrend}</b>
                ) : null}
              </div>
              <small>{dashboard.trafficDetail}</small>
            </MetricCard>
            <MetricCard>
              <span>Signups</span>
              <strong>{dashboard.signups}</strong>
              <small>{dashboard.signupDetail}</small>
            </MetricCard>
            <MetricCard>
              <span>New prospects</span>
              <strong>{dashboard.prospects}</strong>
              <small>{dashboard.prospectDetail}</small>
            </MetricCard>
            <MetricCard>
              <span>Trending topics</span>
              <strong>24</strong>
              <small>New signals surfaced</small>
            </MetricCard>
            <MetricCard>
              <span>Scheduled posts</span>
              <strong>{dashboard.scheduled}</strong>
              <small>{dashboard.scheduledDetail}</small>
            </MetricCard>
          </div>

          <div className="hero-chief-composer">
            <span>Ask your Chief Marketing Officer...</span>
            <button type="button" aria-label="Send">
              <HeroIcon name="arrow" size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="hero-native-notification visible" key={event.id}>
        <span className="hero-notification-icon">
          <BrandMark
            className="hero-notification-mark"
            size={22}
            tone="black"
          />
        </span>
        <div>
          <header>
            <strong>Chief</strong>
            <time>now</time>
          </header>
          <b>{event.title}</b>
          <p>
            <span>{event.agent}</span> · {event.body}
          </p>
        </div>
      </div>
    </div>
  );
}
