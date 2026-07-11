import { PLAYBOOKS } from "../../desktop/src/lib/playbooks";
import { ConnectionGrid, ProactiveDemo, RuntimeDemo, SocialCalendarDemo } from "./landing-demos";
import { HeroWorkspace } from "./hero-workspace";
import { RailsLayout } from "./rails-layout";
import { TeamPlaybooks, type LandingPlaybook } from "./team-playbooks";
import { WorkChannels } from "./work-channels";

const landingPlaybooks: LandingPlaybook[] = PLAYBOOKS.map((playbook) => ({
  id: playbook.id,
  title: playbook.title,
  summary: playbook.summary,
  agentId: playbook.agentId,
  integrations: playbook.integrations.map(({ domain, label }) => ({ domain, label })),
  goal: playbook.goal,
  workflow: playbook.workflow,
  deliverables: playbook.deliverables,
}));

function AppleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function Wordmark() {
  return (
    <a className="wordmark" href="#top" aria-label="Marketer home">
      <strong>marketer</strong>
    </a>
  );
}

export default function Home() {
  return (
    <main id="top" className="landing">
      <RailsLayout>
        <header className="site-header">
          <nav aria-label="Main navigation">
            <Wordmark />
            <div className="nav-links">
              <a href="#product">Product</a>
              <a href="#team">The team</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div className="nav-actions">
              <a href="/sign-in">Sign in</a>
              <a href="/download">Download</a>
            </div>
          </nav>
        </header>

        <section className="hero">
          <h1>Your marketing team. <br />Already at work.</h1>
          <div className="hero-intro">
            <p>
              Set an outcome once. Proactive specialist agents keep recurring work on schedule
              and bring results and decisions back for review.
            </p>
            <a className="button button-primary" href="/download">Download for macOS <AppleIcon /></a>
          </div>
        </section>

        <section className="hero-product" aria-label="Marketer desktop workspace">
          <HeroWorkspace />
        </section>

        <section className="feature-section social-feature" id="product">
          <div className="feature-copy">
            <h2>Keep every channel moving.</h2>
            <p>Marketer builds the content plan, creates channel-ready drafts and fills the calendar. Nothing publishes until the approval rules you set are satisfied.</p>
          </div>
          <div className="feature-backdrop calendar-backdrop"><SocialCalendarDemo /></div>
        </section>

        <TeamPlaybooks playbooks={landingPlaybooks} />

        <section className="feature-section runtime-feature">
          <div className="feature-copy">
            <h2>Local when you want it. Cloud when you need it.</h2>
            <p>Run agents on your machine with Claude, ChatGPT, OpenCode or OpenClaw. Deploy the same workspace to the cloud when work needs to continue after you close the laptop.</p>
          </div>
          <div className="runtime-surface"><RuntimeDemo /></div>
        </section>

        <section className="connections-section">
          <div className="feature-copy">
            <h2>Your stack is part of the workspace.</h2>
            <p>Give agents access to the systems that hold your customer, campaign and performance data. They use the available tools for the job and keep the evidence attached.</p>
          </div>
          <ConnectionGrid />
        </section>

        <section className="feature-section proactive-feature">
          <div className="feature-copy">
            <h2>The work keeps moving while you are away.</h2>
            <p>Give an agent a recurring brief and close the laptop. It runs on schedule, keeps a record of what it did and sends you a digest when results or decisions are ready.</p>
          </div>
          <div className="proactive-surface"><ProactiveDemo /></div>
        </section>

        <section className="feature-section channels-feature">
          <div className="feature-copy">
            <h2>And meets you where you already work.</h2>
            <p>Use Marketer in Slack, Claude or ChatGPT, and receive a weekly digest by email. Results, sources and approvals stay together in the workspace.</p>
          </div>
          <WorkChannels />
        </section>

        <section className="pricing" id="pricing">
          <div className="pricing-top">
            <div>
              <h2>Get started for free.</h2>
            </div>
            <div className="pricing-detail">
              <div className="pricing-summary">
                <div><strong>$44</strong><span>per month</span></div>
                <p>With annual billing. Monthly billing is available at checkout.</p>
              </div>
              <p>One workspace includes every specialist agent, recurring work and approvals.</p>
              <a className="button button-primary" href="/download">Download for macOS <AppleIcon /></a>
            </div>
          </div>

          <div className="pricing-inclusions">
            <header>
              <h3>One subscription. Every agent.</h3>
              <p>Bring in the specialist the work needs, without changing plans or counting seats.</p>
            </header>
            <div className="pricing-table-wrap">
              <table className="pricing-table">
                <thead><tr><th>Agent</th><th>What they take on</th><th>Included</th></tr></thead>
                <tbody>
                  <tr><td>Lead agent</td><td>Briefs, priorities, coordination and review</td><td><span>Yes</span></td></tr>
                  <tr><td>Analyst</td><td>Performance reviews, reporting and anomalies</td><td><span>Yes</span></td></tr>
                  <tr><td>Content writer</td><td>Research, drafts and the social calendar</td><td><span>Yes</span></td></tr>
                  <tr><td>Prospector</td><td>Account research, contacts and opportunities</td><td><span>Yes</span></td></tr>
                  <tr><td>Ads manager</td><td>Planning, monitoring and optimisation</td><td><span>Yes</span></td></tr>
                </tbody>
              </table>
            </div>
            <div className="pricing-features">
              <div><strong>Recurring work</strong><span>Schedule the work once.</span></div>
              <div><strong>Approval rules</strong><span>Keep judgment with your team.</span></div>
              <div><strong>Connected tools</strong><span>Bring your existing stack.</span></div>
              <div><strong>Run it your way</strong><span>Desktop, browser or cloud.</span></div>
            </div>
          </div>
        </section>

        <section className="closing">
          <h2><span>Download marketer and</span><span>let the work begin.</span></h2>
          <a className="button button-primary" href="/download">Download for macOS <AppleIcon /></a>
        </section>

        <footer>
          <Wordmark />
          <div>
            <a href="#product">Product</a>
            <a href="#team">The team</a>
            <a href="#pricing">Pricing</a>
            <a href="/download">Download</a>
          </div>
          <span>© 2026 Marketer</span>
        </footer>
      </RailsLayout>
    </main>
  );
}
