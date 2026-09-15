import type { FaqItem } from "../faq-list";
import { DownloadButton } from "../download-button";
import { FaqList } from "../faq-list";

const highlights = [
  "Every specialist agent",
  "Unlimited connected services",
  "Recurring work and approvals",
  "Reports, charts and run history",
  "Local and cloud-ready execution",
];

const capabilities = [
  { name: "Specialist AI agents", value: "Every specialist" },
  { name: "Connected channels and tools", value: "Included" },
  { name: "Recurring and one-off work", value: "Included" },
  { name: "Activity insights and generated reports", value: "Included" },
  { name: "Charts, tables and decision-ready artifacts", value: "Included" },
  { name: "Approval rules", value: "Automatic or review first" },
  { name: "Playbook library", value: "Included" },
  { name: "Local execution", value: "Included" },
  { name: "Cloud agent deployment", value: "Included when configured" },
  { name: "Slack and external channels", value: "Included when connected" },
];

const faqs: FaqItem[] = [
  {
    question: "What is included?",
    answer:
      "Every specialist agent, playbook, schedule, integration surface and approval control available in Chief is included in one workspace.",
  },
  {
    question: "Is Chief free during beta?",
    answer:
      "Yes. Every agent and workspace feature is free while Chief is in beta. We will give you clear notice before paid plans begin.",
  },
  {
    question: "What is an agent run?",
    answer:
      "A run is a piece of work completed by an agent, such as a growth report, prospect search, campaign review or content brief. Runs keep their evidence and outputs.",
  },
  {
    question: "Can Chief act automatically?",
    answer:
      "You choose. Recurring work can run automatically within the permissions you grant, while sensitive actions can stay review-first. Publishing, spending and other consequential work remain under your control unless you explicitly allow them.",
  },
  {
    question: "Can it use my existing tools?",
    answer:
      "Yes. Chief can work with connected engineering, analytics, communication, advertising and workspace services, limited to the permissions you grant.",
  },
  {
    question: "Does it run with my laptop closed?",
    answer:
      "Local work requires your Mac to be available. You can deploy an agent to supported cloud infrastructure for work that must continue while the laptop is closed.",
  },
];

export function PricingOffer() {
  return (
    <>
      <section className="pt-4 text-center">
        <h1 className="text-foreground mx-auto max-w-[16em] text-[clamp(40px,5.2vw,68px)] leading-[1.04] font-medium tracking-[-0.05em]">
          Free during beta.
        </h1>
        <p className="text-muted-foreground mx-auto mt-6 max-w-[600px] text-lg leading-[1.65]">
          Use every agent and workspace feature while we build Chief with our
          earliest teams. No card and no surprise charge.
        </p>
      </section>

      <section className="mt-16 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="bg-card rounded-3xl p-9 max-md:p-7">
          <h2 className="text-foreground text-[clamp(24px,2.6vw,32px)] leading-[1.14] font-medium tracking-[-0.045em]">
            Bring the whole team.
          </h2>
          <p className="text-muted-foreground mt-3.5 max-w-[32em] text-[15px] leading-[1.6]">
            Chief is free while the beta is open. We will share any future plans
            clearly before billing exists, so you can decide what works for your
            team.
          </p>
          <div className="mt-7">
            <DownloadButton variant="page" />
          </div>
        </div>
        <div className="bg-card rounded-3xl p-9 max-md:p-7">
          <ul className="flex flex-col gap-3.5">
            {highlights.map((highlight) => (
              <li
                className="text-foreground flex items-center gap-3 text-[15px]"
                key={highlight}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-[#7adb9e]" />
                {highlight}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-20">
        <header className="max-w-[620px]">
          <h2 className="text-foreground text-[clamp(28px,3.4vw,40px)] leading-[1.12] font-medium tracking-[-0.045em]">
            Everything needed to keep work moving.
          </h2>
          <p className="text-muted-foreground mt-3 text-base leading-[1.6]">
            The product is organised around completed work, not artificial
            feature gates.
          </p>
        </header>
        <div className="bg-card divide-border mt-8 divide-y overflow-hidden rounded-3xl">
          {capabilities.map((capability) => (
            <div
              className="flex items-center justify-between gap-6 px-7 py-5 max-md:px-6"
              key={capability.name}
            >
              <span className="text-muted-foreground text-[15px]">
                {capability.name}
              </span>
              <strong className="text-foreground text-right text-[15px] font-medium">
                {capability.value}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-foreground text-[clamp(28px,3.4vw,40px)] leading-[1.12] font-medium tracking-[-0.045em]">
          Before you put the team to work.
        </h2>
        <FaqList className="mt-8" items={faqs} />
      </section>
    </>
  );
}
