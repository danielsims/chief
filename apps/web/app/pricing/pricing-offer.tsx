import Link from "next/link";

import { AppleIcon } from "../marketing-chrome";

const agents = [
  ["Chief", "Strategy, priorities, delegation and review"],
  ["Engineer", "Code, product changes and technical delivery"],
  ["Marketer", "Campaign planning, monitoring and growth execution"],
  ["Analyst", "Traffic, funnel, campaign and growth reporting"],
  ["Writer", "Research, drafts and channel-native creative"],
  ["Researcher", "Buying signals, prospects and timely conversations"],
  ["Setup agent", "Connections, credentials and workspace configuration"],
];

const capabilities = [
  ["Specialist AI agents", "Every specialist"],
  ["Connected channels and tools", "Included"],
  ["Recurring and one-off work", "Included"],
  ["Activity insights and generated reports", "Included"],
  ["Charts, tables and decision-ready artifacts", "Included"],
  ["Approval rules", "Automatic or review first"],
  ["Playbook library", "Included"],
  ["Local execution", "Included"],
  ["Cloud agent deployment", "Included when configured"],
  ["Slack and external channels", "Included when connected"],
];

const faqs = [
  [
    "What is included?",
    "Every specialist agent, playbook, schedule, integration surface and approval control available in Chief is included in one workspace.",
  ],
  [
    "Is Chief free during beta?",
    "Yes. Every agent and workspace feature is free while Chief is in beta. We will give you clear notice before paid plans begin.",
  ],
  [
    "What is an agent run?",
    "A run is a piece of work completed by an agent, such as a growth report, prospect search, campaign review or content brief. Runs keep their evidence and outputs.",
  ],
  [
    "Can Chief act automatically?",
    "You choose. Recurring work can run automatically within the permissions you grant, while sensitive actions can stay review-first. Publishing, spending and other consequential work remain under your control unless you explicitly allow them.",
  ],
  [
    "Can it use my existing tools?",
    "Yes. Chief can work with connected engineering, analytics, communication, advertising and workspace services, limited to the permissions you grant.",
  ],
  [
    "Does it run with my laptop closed?",
    "Local work requires your Mac to be available. You can deploy an agent to supported cloud infrastructure for work that must continue while the laptop is closed.",
  ],
];

export function PricingOffer() {
  return (
    <>
      <section className="pricing-hero">
        <div>
          <h1>
            <span>Free during beta.</span>
          </h1>
          <p>
            Use every agent and workspace feature while we build Chief with our
            earliest teams. No card and no surprise charge.
          </p>
        </div>
      </section>
      <section className="offer-card">
        <div className="offer-summary">
          <h2>Bring the whole team.</h2>
          <p>
            Chief is free while the beta is open. We will share any future plans
            clearly before billing exists, so you can decide what works for your
            team.
          </p>
          <Link className="button button-primary" href="/download">
            Download Chief
            <AppleIcon />
          </Link>
        </div>
        <div className="offer-highlights">
          <ul>
            <li>Every specialist agent</li>
            <li>Unlimited connected services</li>
            <li>Recurring work and approvals</li>
            <li>Reports, charts and run history</li>
            <li>Local and cloud-ready execution</li>
          </ul>
        </div>
      </section>
      <section className="pricing-agents">
        <header>
          <h2>Every specialist. No seat counting.</h2>
          <p>Bring in the agent the work needs without changing plans.</p>
        </header>
        <div className="agent-inclusion-grid">
          {agents.map(([name, detail]) => (
            <article key={name}>
              <strong>{name}</strong>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="plan-comparison">
        <header>
          <h2>Everything needed to keep work moving.</h2>
          <p>
            The product is organised around completed work, not artificial
            feature gates.
          </p>
        </header>
        <div className="comparison-list">
          {capabilities.map(([name, value]) => (
            <div key={name}>
              <span>{name}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="pricing-faq">
        <header>
          <h2>Before you put the team to work.</h2>
        </header>
        <div>
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
