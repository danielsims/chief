"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth } from "convex/react";

import { api } from "@chief/backend/convex/_generated/api";

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
    "Is there a free trial?",
    "Yes. You can start the trial from the desktop app and choose monthly or yearly billing before checkout.",
  ],
  [
    "What is an agent run?",
    "A run is a piece of work completed by an agent, such as a growth report, prospect search, campaign review or content brief. Runs keep their evidence and outputs.",
  ],
  [
    "Does Chief publish automatically?",
    "No. Chief is review-first by design. It keeps the marketing operation moving by researching, planning and drafting work for you to approve. Automated posting can reduce reach on some platforms, so publishing stays under your control.",
  ],
  [
    "Can it use my existing tools?",
    "Yes. Chief can work with connected analytics, advertising, social and workspace services, limited to the permissions you grant.",
  ],
  [
    "Does it run with my laptop closed?",
    "Local work requires your Mac to be available. You can deploy an agent to supported cloud infrastructure for work that must continue while the laptop is closed.",
  ],
];

export function PricingOffer() {
  const [billing, setBilling] = useState<"yearly" | "monthly">("yearly");
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const resumedCheckout = useRef(false);
  const { isAuthenticated } = useConvexAuth();
  const createCheckoutSession = useAction(api.billing.createCheckoutSession);
  const yearly = billing === "yearly";
  const startCheckout = useCallback(
    async (plan: "yearly" | "monthly") => {
      if (!isAuthenticated) {
        const callbackUrl = `/pricing?checkout=${plan}`;
        window.location.assign(
          `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        );
        return;
      }
      setOpeningCheckout(true);
      try {
        const origin = window.location.origin;
        const result = await createCheckoutSession({
          plan: plan === "yearly" ? "annual" : "monthly",
          successUrl: `${origin}/download?checkout=success`,
          cancelUrl: `${origin}/pricing`,
        });
        window.location.assign(result.url);
      } finally {
        setOpeningCheckout(false);
      }
    },
    [createCheckoutSession, isAuthenticated],
  );

  useEffect(() => {
    if (!isAuthenticated || resumedCheckout.current) return;
    const plan = new URLSearchParams(window.location.search).get("checkout");
    if (plan !== "yearly" && plan !== "monthly") return;
    resumedCheckout.current = true;
    const timer = window.setTimeout(() => void startCheckout(plan), 0);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, startCheckout]);
  return (
    <>
      <section className="pricing-hero">
        <div>
          <h1>
            <span>Your marketing team.</span>
            <span>One clear price.</span>
          </h1>
          <p>
            More than a scheduler. Chief gives every recurring marketing job a
            specialist owner, the tools to do it, and a place to bring the
            result back.
          </p>
        </div>
        <div className="billing-toggle" aria-label="Billing frequency">
          <button
            type="button"
            className={!yearly ? "active" : ""}
            onClick={() => setBilling("monthly")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={yearly ? "active" : ""}
            onClick={() => setBilling("yearly")}
          >
            Yearly <span>Save 10%</span>
          </button>
        </div>
      </section>
      <section className="offer-card">
        <div className="offer-summary">
          <h2>
            {yearly ? "$44" : "$49"}
            <small>/month</small>
          </h2>
          <p>
            {yearly ? "Billed yearly at $529." : "Billed monthly."} One
            workspace with the whole specialist team.
          </p>
          <button
            className="button button-primary"
            type="button"
            disabled={openingCheckout}
            onClick={() => void startCheckout(billing)}
          >
            {openingCheckout ? "Opening checkout..." : "Start free trial"}{" "}
            <AppleIcon />
          </button>
        </div>
        <div className="offer-highlights">
          <p>Included from day one</p>
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
          <span className="page-eyebrow">FAQ</span>
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
