"use client";

import { useEffect, useRef, useState } from "react";

import { LandingAppShell } from "./landing-app-shell";

export { ProactiveDemo } from "./proactive-demo";

const calendarPosts = [
  {
    day: 2,
    title: "Customer interview synthesis",
    owner: "Researcher",
    tone: "blue",
  },
  {
    day: 4,
    title: "Release readiness review",
    owner: "Engineer",
    tone: "pink",
  },
  { day: 8, title: "Weekly performance brief", owner: "Analyst", tone: "cyan" },
  { day: 10, title: "Customer update", owner: "Writer", tone: "white" },
  { day: 16, title: "Dependency audit", owner: "Operations", tone: "red" },
  { day: 18, title: "Market signal scan", owner: "Researcher", tone: "blue" },
  { day: 23, title: "Release notes", owner: "Writer", tone: "pink" },
  {
    day: 25,
    title: "Monthly operating review",
    owner: "Chief",
    tone: "blue",
    creating: true,
  },
];

function MiniIcon({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SocialCalendarDemo() {
  const calendarRef = useRef<HTMLDivElement>(null);
  const [isCalendarVisible, setIsCalendarVisible] = useState(false);
  const currentMonth = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date());
  const monthDate = new Date();
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const leadingDays = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0,
  ).getDate();
  const calendarCells = Array.from(
    { length: Math.ceil((leadingDays + daysInMonth) / 7) * 7 },
    (_, index) => {
      const day = index - leadingDays + 1;
      return day > 0 && day <= daysInMonth ? day : null;
    },
  );

  useEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsCalendarVisible(true);
        observer.disconnect();
      },
      { threshold: 0.12 },
    );

    observer.observe(calendar);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={
        isCalendarVisible ? "calendar-demo is-visible" : "calendar-demo"
      }
      ref={calendarRef}
    >
      <LandingAppShell
        activeNav="Schedule"
        label="Chief desktop app schedule with recurring work from a team of specialist agents"
      >
        <div className="calendar-main">
          <header className="calendar-page-heading">
            <div>
              <strong>Schedule</strong>
              <small>
                Direct when agents work and review what they have planned.
              </small>
            </div>
            <button type="button">
              <span>＋</span> New agent work
            </button>
          </header>
          <div className="calendar-toolbar">
            <strong>{currentMonth}</strong>
            <div>
              <button className="calendar-review-trigger" type="button">
                <MiniIcon path="M4 6h12v10H4zM7 4h6v3H7" />
                Review <em>2</em>
              </button>
              <button type="button">
                <MiniIcon path="M4 5h12M6 10h8M8 15h4" />
                Filters
              </button>
              <button type="button">Today</button>
              <button aria-label="Previous" type="button">
                ‹
              </button>
              <button aria-label="Next" type="button">
                ›
              </button>
              <span>
                <b>Month</b>
                <b>Week</b>
                <b>Day</b>
              </span>
            </div>
          </div>
          <div className="calendar-body">
            <section>
              <div className="calendar-weekdays">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                  (day) => (
                    <span key={day}>{day}</span>
                  ),
                )}
              </div>
              <div className="calendar-grid">
                {calendarCells.map((day, cellIndex) => {
                  const post = calendarPosts.find((item) => item.day === day);
                  const postIndex = post ? calendarPosts.indexOf(post) : 0;
                  return (
                    <div
                      className={`calendar-day${day === null ? "is-outside" : ""}`}
                      key={`${day ?? "outside"}-${cellIndex}`}
                    >
                      {day !== null ? <span>{day}</span> : null}
                      {post ? (
                        <div
                          className={`calendar-post post-${post.tone}`}
                          style={{ animationDelay: `${postIndex * 140}ms` }}
                        >
                          <i />
                          <div>
                            <strong>{post.title}</strong>
                            <small>9:30 AM · {post.owner}</small>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
            <aside className="calendar-review-popover">
              <header>
                <div>
                  <strong>Schedule inbox</strong>
                  <span>Agent work waiting for your judgment.</span>
                </div>
              </header>
              <button type="button">
                <i />
                <div>
                  <strong>Customer update</strong>
                  <span>Writer · Thursday at 10:00 am</span>
                </div>
                <b>›</b>
              </button>
              <button type="button">
                <i />
                <div>
                  <strong>Release readiness review</strong>
                  <span>Engineer · Friday at 9:30 am</span>
                </div>
                <b>›</b>
              </button>
            </aside>
          </div>
          <footer className="calendar-footer">
            <span>
              <i className="violet" /> Prospecting
            </span>
            <span>
              <i className="sky" /> Analytics
            </span>
            <span>
              <i className="rose" /> Content
            </span>
            <span>
              <i className="green" /> 5 active schedules
            </span>
          </footer>
        </div>
      </LandingAppShell>
    </div>
  );
}

interface Provider {
  domain: string;
  name: string;
  localIcon?: "analytics" | "gmail" | "google-ads";
  white?: boolean;
  lightBackground?: boolean;
}

const providerRows: Provider[][] = [
  [
    {
      domain: "analytics.googleapis.com",
      name: "Google Analytics",
      localIcon: "analytics",
    },
    {
      domain: "googleads.googleapis.com",
      name: "Google Ads",
      localIcon: "google-ads",
    },
    { domain: "meta.com", name: "Meta" },
    { domain: "linkedin.com", name: "LinkedIn" },
    { domain: "instagram.com", name: "Instagram", white: true },
    { domain: "tiktok.com", name: "TikTok" },
    { domain: "www.youtube.com", name: "YouTube" },
    { domain: "mailchimp.com", name: "Mailchimp", white: true },
    { domain: "klaviyo.com", name: "Klaviyo" },
    { domain: "canva.com", name: "Canva" },
  ],
  [
    { domain: "salesforce.com", name: "Salesforce" },
    { domain: "hubspot.com", name: "HubSpot" },
    { domain: "stripe.com", name: "Stripe" },
    { domain: "shopify.dev", name: "Shopify" },
    { domain: "intercom.com", name: "Intercom" },
    { domain: "gmail.googleapis.com", name: "Gmail", localIcon: "gmail" },
    { domain: "slack.com", name: "Slack" },
    { domain: "notion.com", name: "Notion" },
    { domain: "monday.com", name: "Monday" },
    { domain: "program.video", name: "Program" },
    { domain: "airtable.com", name: "Airtable" },
  ],
  [
    { domain: "posthog.com", name: "PostHog" },
    { domain: "mixpanel.com", name: "Mixpanel" },
    { domain: "figma.com", name: "Figma" },
    { domain: "linear.app", name: "Linear" },
    { domain: "sentry.io", name: "Sentry", lightBackground: true },
    { domain: "supabase.com", name: "Supabase" },
    { domain: "wordpress.com", name: "WordPress" },
    { domain: "webflow.com", name: "Webflow" },
    { domain: "cloudflare.com", name: "Cloudflare" },
    { domain: "ahrefs.com", name: "Ahrefs", white: true },
  ],
];

function GoogleProductIcon({
  type,
}: {
  type: NonNullable<Provider["localIcon"]>;
}) {
  if (type === "analytics") {
    return (
      <svg
        className="integration-product-icon analytics-icon"
        aria-hidden="true"
        viewBox="0 0 24 24"
      >
        <path d="M22.84 3v18a2.98 2.98 0 0 1-3.34 2.98 2.96 2.96 0 0 1-2.61-3.1V3.12A2.97 2.97 0 0 1 19.51.02 3 3 0 0 1 22.84 3ZM4.13 18.05a2.97 2.97 0 1 0 0 5.95 2.97 2.97 0 0 0 0-5.95Zm7.88-9.01a2.98 2.98 0 0 0-2.95 3.13v7.99c0 2.16.96 3.48 2.35 3.76a2.98 2.98 0 0 0 3.57-2.93v-8.96a2.98 2.98 0 0 0-2.97-2.99Z" />
      </svg>
    );
  }
  if (type === "gmail") {
    return (
      <svg
        className="integration-product-icon gmail-icon"
        aria-hidden="true"
        viewBox="0 0 24 24"
      >
        <path d="M24 5.46v13.91c0 .9-.73 1.63-1.64 1.63h-3.81v-9.27L12 16.64l-6.55-4.91V21H1.64A1.64 1.64 0 0 1 0 19.37V5.46c0-2.03 2.31-3.18 3.93-1.97l1.52 1.15L12 9.55l6.55-4.91 1.52-1.15C21.69 2.28 24 3.43 24 5.46Z" />
      </svg>
    );
  }
  return (
    <svg
      className="integration-product-icon google-ads-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
    >
      <path d="M4 22.93a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm19.46-6L15.46 3.07a4 4 0 1 0-6.93 4l8 13.86a4 4 0 1 0 6.93-4ZM7.51 4.84 1.56 15.15A4.5 4.5 0 0 1 4 14.43a4.5 4.5 0 0 1 4.49 4.71l3.22-5.57-3.61-6.25a4 4 0 0 1-.59-2.48Z" />
    </svg>
  );
}

function IntegrationMark({ provider }: { provider: Provider }) {
  return (
    <div className="integration-mark">
      <span
        className={`integration-logo${provider.lightBackground ? "light-background" : ""}`}
      >
        {provider.localIcon ? (
          <GoogleProductIcon type={provider.localIcon} />
        ) : (
          <img
            className={provider.white ? "white-logo" : undefined}
            src={`https://integrations.sh/logo/${provider.domain}`}
            alt=""
            loading="lazy"
          />
        )}
      </span>
      <span>{provider.name}</span>
    </div>
  );
}

export function ConnectionGrid() {
  return (
    <div
      className="integration-field"
      aria-label="Services that can be connected to Chief"
    >
      {providerRows.map((providers, rowIndex) => (
        <div className={`integration-row row-${rowIndex + 1}`} key={rowIndex}>
          <div className="integration-track">
            {[0, 1].map((copy) => (
              <div
                className="integration-segment"
                aria-hidden={copy === 1}
                key={copy}
              >
                {providers.map((provider) => (
                  <IntegrationMark
                    provider={provider}
                    key={`${copy}-${provider.domain}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LaptopIcon() {
  return <MiniIcon path="M4 5h12v8H4zM2 16h16M7 16h6" />;
}
function CloudIcon() {
  return (
    <MiniIcon path="M6 15h9a3 3 0 0 0 .5-6A5 5 0 0 0 6 8.5 3.3 3.3 0 0 0 6 15z" />
  );
}

export function RuntimeDemo() {
  return (
    <div className="runtime-demo">
      <div className="runtime-setup">
        <header>
          <strong>Where should agents run?</strong>
          <span>Choose the workspace for this company.</span>
        </header>
        <div className="mode-options">
          <div className="selected">
            <span>
              <LaptopIcon />
            </span>
            <p>
              <strong>This Mac</strong>
              <small>
                Keep work, data and connected accounts close to this machine.
              </small>
            </p>
            <i>✓</i>
          </div>
          <div>
            <span>
              <CloudIcon />
            </span>
            <p>
              <strong>Cloud workspace</strong>
              <small>Keep agents working when this computer is offline.</small>
            </p>
          </div>
        </div>
        <p className="runtime-heading">Agent app</p>
        <div className="provider-options">
          <div>
            <img src="https://integrations.sh/logo/claude.ai" alt="" />
            <p>
              <strong>Claude</strong>
              <span>Uses Claude on this Mac.</span>
            </p>
          </div>
          <div>
            <img
              className="white-logo"
              src="https://integrations.sh/logo/chatgpt.com"
              alt=""
            />
            <p>
              <strong>ChatGPT</strong>
              <span>Uses your existing ChatGPT setup.</span>
            </p>
          </div>
        </div>
        <div className="readiness-list">
          <div>
            <i>✓</i>
            <p>
              <strong>Account</strong>
              <span>Signed in and ready.</span>
            </p>
          </div>
          <div>
            <i>✓</i>
            <p>
              <strong>This Mac</strong>
              <span>The local agent service is reachable.</span>
            </p>
          </div>
          <div>
            <i>✓</i>
            <p>
              <strong>Agent app</strong>
              <span>Claude on this Mac</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
