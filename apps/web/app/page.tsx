import Link from "next/link";

import type { LandingPlaybook } from "./team-playbooks";
import { HeroWorkspace } from "./hero-workspace";
import {
  ConnectionGrid,
  ProactiveDemo,
  RuntimeDemo,
  SocialCalendarDemo,
} from "./landing-demos";
import {
  AppleIcon,
  MarketingFooter,
  MarketingHeader,
} from "./marketing-chrome";
import { RailsLayout } from "./rails-layout";
import { TeamPlaybooks } from "./team-playbooks";
import { WorkChannels } from "./work-channels";

const landingPlaybooks: LandingPlaybook[] = [
  {
    id: "weekly-operating-plan",
    title: "Weekly operating plan",
    summary: "Priorities, owners and decisions in one place.",
    agentId: "cmo",
    integrations: [
      { domain: "slack.com", label: "Slack" },
      { domain: "linear.app", label: "Linear" },
      { domain: "drive.google.com", label: "Google Drive" },
    ],
    goal: "Turn scattered team context into a focused week of work.",
    workflow: [
      "Collect current priorities, open decisions and work already underway.",
      "Sequence the work, delegate the research and bring real tradeoffs back for review.",
    ],
    deliverables: ["A sequenced plan", "Clear owners", "A short decision list"],
  },
  {
    id: "performance-review",
    title: "Performance review",
    summary: "What changed, why and what to do next.",
    agentId: "analyst",
    integrations: [
      { domain: "posthog.com", label: "PostHog" },
      { domain: "analytics.googleapis.com", label: "Google Analytics" },
      { domain: "stripe.com", label: "Stripe" },
    ],
    goal: "Turn product and business data into a short decision brief.",
    workflow: [
      "Compare the latest complete period with the previous one.",
      "Find the meaningful changes, verify likely causes and recommend the next action.",
    ],
    deliverables: ["Evidence-backed findings", "Decision-ready charts"],
  },
  {
    id: "customer-update",
    title: "Customer update",
    summary: "A clear update assembled from the real work.",
    agentId: "content",
    integrations: [
      { domain: "notion.com", label: "Notion" },
      { domain: "linear.app", label: "Linear" },
      { domain: "gmail.com", label: "Gmail" },
    ],
    goal: "Keep customers informed without rebuilding the story by hand.",
    workflow: [
      "Collect completed work, decisions and release context.",
      "Draft the update in the right voice and leave it ready for approval.",
    ],
    deliverables: ["Customer-ready draft", "Source links", "Approval copy"],
  },
  {
    id: "market-watch",
    title: "Market watch",
    summary: "New signals, shifts and opportunities.",
    agentId: "prospector",
    integrations: [
      { domain: "reddit.com", label: "Reddit" },
      { domain: "linkedin.com", label: "LinkedIn" },
      { domain: "news.ycombinator.com", label: "Hacker News" },
    ],
    goal: "Keep useful external signals flowing into the team.",
    workflow: [
      "Scan the places where customers and peers discuss the problem.",
      "Verify the strongest signals and attach the source, context and recommended response.",
    ],
    deliverables: ["Qualified signals", "Evidence", "Recommended actions"],
  },
  {
    id: "experiment-monitor",
    title: "Experiment monitor",
    summary: "Watch the work and flag the moment it needs attention.",
    agentId: "ads",
    integrations: [
      { domain: "posthog.com", label: "PostHog" },
      { domain: "sentry.io", label: "Sentry" },
      { domain: "vercel.com", label: "Vercel" },
    ],
    goal: "Keep live experiments moving safely without constant checking.",
    workflow: [
      "Track the agreed success and guardrail metrics on schedule.",
      "Document meaningful movement and bring exceptions back before taking action.",
    ],
    deliverables: ["Run log", "Exception alerts", "Next-step recommendation"],
  },
  {
    id: "ship-product-change",
    title: "Ship a product change",
    summary: "A scoped change, reviewed and ready to merge.",
    agentId: "engineer",
    integrations: [
      { domain: "github.com", label: "GitHub" },
      { domain: "linear.app", label: "Linear" },
      { domain: "vercel.com", label: "Vercel" },
    ],
    goal: "Turn a clear product brief into a tested, reviewable code change.",
    workflow: [
      "Inspect the relevant code and define the smallest safe implementation.",
      "Build and test the change, then prepare a guarded pull request for review.",
    ],
    deliverables: [
      "Working code",
      "Verification notes",
      "Reviewable pull request",
    ],
  },
];

export default function Home() {
  return (
    <main id="top" className="landing">
      <RailsLayout>
        <MarketingHeader />

        <section className="hero">
          <h1>
            Your team of agents <br />
            already at work.
          </h1>
          <div className="hero-intro">
            <p>
              Bring the work to Chief once. A coordinated team of specialist
              agents researches, builds, writes and keeps recurring work moving,
              then brings the useful results and real decisions back to you.
            </p>
            <Link className="button button-primary" href="/download">
              Download for macOS <AppleIcon />
            </Link>
          </div>
        </section>

        <section className="hero-product" aria-label="Chief desktop workspace">
          <HeroWorkspace />
        </section>

        <section className="feature-section social-feature" id="product">
          <div className="feature-copy">
            <h2>Give every kind of work somewhere to move.</h2>
            <p>
              Plan product reviews, customer research, reporting, launches and
              the recurring work between them. Agents work in shared channels,
              stay on schedule and pause at the approval rules you set.
            </p>
          </div>
          <div className="feature-backdrop calendar-backdrop">
            <SocialCalendarDemo />
          </div>
        </section>

        <TeamPlaybooks playbooks={landingPlaybooks} />

        <section className="feature-section runtime-feature">
          <div className="feature-copy">
            <h2>Local when you want it. Cloud when you need it.</h2>
            <p>
              Run agents on your machine with Claude, ChatGPT, OpenCode or
              OpenClaw. Deploy the same workspace to the cloud when work needs
              to continue after you close the laptop.
            </p>
          </div>
          <div className="runtime-surface">
            <RuntimeDemo />
          </div>
        </section>

        <section className="connections-section">
          <div className="feature-copy">
            <h2>Your stack is part of the workspace.</h2>
            <p>
              Give agents access to the systems that hold your product, company
              and customer context. They use the available tools for the job and
              keep the evidence attached.
            </p>
          </div>
          <ConnectionGrid />
        </section>

        <section className="feature-section proactive-feature">
          <div className="feature-copy">
            <h2>The work keeps moving while you are away.</h2>
            <p>
              Give an agent a recurring brief and close the laptop. It runs on
              schedule, keeps a record of what it did and sends you a digest
              when results or decisions are ready.
            </p>
          </div>
          <div className="proactive-surface">
            <ProactiveDemo />
          </div>
        </section>

        <section className="feature-section channels-feature">
          <div className="feature-copy">
            <h2>And meets you where you already work.</h2>
            <p>
              Use Chief in Slack, Claude or ChatGPT, and receive a weekly digest
              by email. Results, sources and approvals stay together in the
              workspace.
            </p>
          </div>
          <WorkChannels />
        </section>

        <section className="closing">
          <h2>
            <span>Download the Chief app</span>
            <span>and let the work begin.</span>
          </h2>
          <Link className="button button-primary" href="/download">
            Download for macOS <AppleIcon />
          </Link>
        </section>

        <MarketingFooter />
      </RailsLayout>
    </main>
  );
}
