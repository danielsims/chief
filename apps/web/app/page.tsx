import type { LandingPlaybook } from "./team-playbooks";
import { PLAYBOOKS } from "../../desktop/src/lib/playbooks";
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

const landingPlaybooks: LandingPlaybook[] = PLAYBOOKS.map((playbook) => ({
  id: playbook.id,
  title: playbook.title,
  summary: playbook.summary,
  agentId: playbook.agentId,
  integrations: playbook.integrations.map(({ domain, label }) => ({
    domain,
    label,
  })),
  goal: playbook.goal,
  workflow: playbook.workflow,
  deliverables: playbook.deliverables,
}));

export default function Home() {
  return (
    <main id="top" className="landing">
      <RailsLayout>
        <MarketingHeader />

        <section className="hero">
          <h1>
            Your marketing team. <br />
            Already at work.
          </h1>
          <div className="hero-intro">
            <p>
              Set an outcome once. Proactive specialist agents keep recurring
              work on schedule and bring results and decisions back for review.
            </p>
            <a className="button button-primary" href="/download">
              Download for macOS <AppleIcon />
            </a>
          </div>
        </section>

        <section className="hero-product" aria-label="Chief desktop workspace">
          <HeroWorkspace />
        </section>

        <section className="feature-section social-feature" id="product">
          <div className="feature-copy">
            <h2>Keep every channel moving.</h2>
            <p>
              Chief builds the content plan, creates channel-ready drafts and
              fills the calendar. Nothing publishes until the approval rules you
              set are satisfied.
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
              Give agents access to the systems that hold your customer,
              campaign and performance data. They use the available tools for
              the job and keep the evidence attached.
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
          <a className="button button-primary" href="/download">
            Download for macOS <AppleIcon />
          </a>
        </section>

        <MarketingFooter />
      </RailsLayout>
    </main>
  );
}
