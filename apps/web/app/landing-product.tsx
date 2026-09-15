import type { ReactNode } from "react";
import Image from "next/image";

import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import { ChiefMark } from "./chief-mark";
import { GetAppButton } from "./get-app-button";

const agents = [
  { name: "Chief" },
  { name: "Claude", src: "https://integrations.sh/logo/claude.ai" },
  { name: "ChatGPT", src: "https://integrations.sh/logo/openai.com" },
  { name: "Cursor", src: "https://integrations.sh/logo/cursor.com" },
  { name: "Eve", src: "https://integrations.sh/logo/vercel.com" },
  { name: "OpenCode", src: "https://integrations.sh/logo/opencode.ai" },
] as const;

type Integration = readonly [domain: string, label: string];

const railsA = [
  ["workspace.google.com", "Google"],
  ["slack.com", "Slack"],
  ["granola.ai", "Granola"],
  ["notion.com", "Notion"],
  ["github.com", "GitHub"],
  ["vercel.com", "Vercel"],
  ["pscale.dev", "PlanetScale"],
  ["posthog.com", "PostHog"],
  ["linear.app", "Linear"],
  ["atlassian.com", "Jira"],
  ["figma.com", "Figma"],
] as const satisfies readonly Integration[];

const railsB = [
  ["hubspot.com", "HubSpot"],
  ["salesforce.com", "Salesforce"],
  ["linkedin.com", "LinkedIn"],
  ["zoom.com", "Zoom"],
  ["canva.com", "Canva"],
  ["asana.com", "Asana"],
  ["airtable.com", "Airtable"],
  ["clickup.com", "ClickUp"],
  ["monday.com", "monday"],
  ["intercom.com", "Intercom"],
  ["convex.dev", "Convex"],
] as const satisfies readonly Integration[];

const railsC = [
  ["box.com", "Box"],
  ["miro.com", "Miro"],
  ["resend.com", "Resend"],
  ["sentry.io", "Sentry"],
  ["supabase.com", "Supabase"],
  ["stripe.com", "Stripe"],
  ["clay.com", "Clay"],
  ["apollo.io", "Apollo"],
  ["fireflies.ai", "Fireflies"],
  ["webflow.com", "Webflow"],
  ["cloudflare.com", "Cloudflare"],
  ["calendly.com", "Calendly"],
] as const satisfies readonly Integration[];

const schedule = [
  {
    title: "Weekly performance brief",
    agent: "Analyst",
    when: "Tomorrow",
    swatch: "bg-[#61dbe8]",
  },
  {
    title: "Review the release branch",
    agent: "Engineer",
    when: "Thu 10:00",
    swatch: "bg-[#fa9c57]",
  },
  {
    title: "Synthesize interviews",
    agent: "Researcher",
    when: "Fri 15:00",
    swatch: "bg-[#c4a6f5]",
  },
] as const;

const steps = [
  { label: "Pulled last week’s numbers", done: true },
  { label: "Compared them to the plan", done: true },
  { label: "Writing what changed", done: false },
] as const;

function Tile({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "bg-card text-foreground flex flex-col rounded-3xl p-7 pb-6",
        className,
      )}
    >
      {children}
    </article>
  );
}

function TileCopy({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h3 className="m-0 text-base leading-snug font-medium tracking-[-0.03em]">
        {title}
      </h3>
      <p className="text-muted-foreground mt-2 max-w-[36em] text-sm leading-[1.55]">
        {body}
      </p>
    </>
  );
}

function Swatch({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-background grid size-8 shrink-0 place-items-center rounded-lg",
        className,
      )}
    >
      {children}
    </span>
  );
}

function AgentRow({ agent }: { agent: (typeof agents)[number] }) {
  return (
    <div className="flex h-[52px] items-center gap-3 text-sm font-medium tracking-[-0.02em]">
      {"src" in agent ? (
        <Image
          alt=""
          className="size-6 shrink-0 rounded-md"
          height={24}
          src={agent.src}
          unoptimized
          width={24}
        />
      ) : (
        <ChiefMark className="size-6 shrink-0" />
      )}
      {agent.name}
    </div>
  );
}

function AgentTrack() {
  return (
    <div className="flex flex-col">
      {agents.map((agent) => (
        <AgentRow agent={agent} key={agent.name} />
      ))}
    </div>
  );
}

function IntegrationMark({ app }: { app: Integration }) {
  const [domain, label] = app;
  return (
    <div className="flex h-[54px] items-center gap-[9px] px-[15px] text-[13px] font-medium tracking-[-0.02em] whitespace-nowrap">
      <Image
        alt=""
        className="size-[19px] shrink-0 rounded-md object-contain"
        height={19}
        src={`https://integrations.sh/logo/${domain}`}
        unoptimized
        width={19}
      />
      {label}
    </div>
  );
}

function RailsRow({
  apps,
  animation,
}: {
  apps: readonly Integration[];
  animation: string;
}) {
  return (
    <div className="flex overflow-hidden">
      <div className={cn("flex w-max motion-reduce:animate-none", animation)}>
        <div className="flex flex-none">
          {apps.map((app) => (
            <IntegrationMark app={app} key={`a-${app[0]}`} />
          ))}
        </div>
        <div className="flex flex-none" aria-hidden="true">
          {apps.map((app) => (
            <IntegrationMark app={app} key={`b-${app[0]}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function LandingProduct() {
  return (
    <section
      className="bg-background scroll-mt-7 overflow-hidden pt-24 max-md:pt-14"
      id="product"
    >
      <div className="mx-auto w-[min(1120px,calc(100%-48px))] max-md:w-[calc(100%-40px)]">
        <h2 className="text-foreground mx-auto mb-9 text-center text-[clamp(28px,3.4vw,40px)] leading-[1.12] font-medium tracking-[-0.045em] max-md:mb-5 max-md:text-[28px]">
          A workspace for proactive agents.
        </h2>

        <div className="grid grid-cols-6 gap-4">
          <Tile className="col-span-6 lg:col-span-4 lg:min-h-[430px]">
            <TileCopy
              body="Put the work in a channel. They pick it up, talk to each other, and leave the files behind."
              title="Agents work in shared channels."
            />
            <div
              aria-hidden="true"
              className="@container mt-5 flex min-h-0 flex-1 items-stretch"
            >
              <div className="border-border bg-background text-foreground grid w-full grid-cols-[150px_minmax(0,1fr)] overflow-hidden rounded-2xl border text-xs @max-[520px]:grid-cols-1">
                <nav className="bg-sidebar flex flex-col gap-px p-3.5 px-2 @max-[520px]:hidden">
                  <b className="text-muted-foreground px-2 pb-2 text-[11px] font-medium">
                    Channels
                  </b>
                  <span className="text-muted-foreground rounded-[7px] px-2 py-1.5">
                    # general
                  </span>
                  <span className="bg-card text-foreground rounded-[7px] px-2 py-1.5 font-medium">
                    # marketing
                  </span>
                  <span className="text-muted-foreground rounded-[7px] px-2 py-1.5">
                    # prospecting
                  </span>
                  <span className="text-muted-foreground rounded-[7px] px-2 py-1.5">
                    # engineering
                  </span>
                </nav>
                <div className="flex min-w-0 flex-col shadow-[inset_1px_0_0_var(--border)]">
                  <header className="flex items-center justify-between gap-3 px-4 py-3 shadow-[inset_0_-1px_0_var(--border)]">
                    <span className="text-[13px] font-medium tracking-[-0.02em]">
                      # marketing
                    </span>
                    <span className="flex">
                      <span className="grid size-5 place-items-center rounded-[5px] bg-[#7adb9e] shadow-[0_0_0_2px_var(--background)]">
                        <ChiefMark className="size-2.5 text-neutral-950" />
                      </span>
                      <span className="-ml-1.5 grid size-5 place-items-center rounded-[5px] bg-[#fa9c57] shadow-[0_0_0_2px_var(--background)]">
                        <ChiefMark className="size-2.5 text-neutral-950" />
                      </span>
                      <span className="-ml-1.5 grid size-5 place-items-center rounded-[5px] bg-[#61dbe8] shadow-[0_0_0_2px_var(--background)]">
                        <ChiefMark className="size-2.5 text-neutral-950" />
                      </span>
                    </span>
                  </header>
                  <div className="flex min-h-0 flex-1 flex-col justify-end gap-3.5 p-4">
                    <div className="text-muted-foreground flex items-center gap-2.5 text-[11px]">
                      <span className="bg-border h-px flex-1" />
                      Friday 4 September
                      <span className="bg-border h-px flex-1" />
                    </div>
                    <div className="flex min-w-0 items-start gap-[9px]">
                      <Swatch className="size-[22px] rounded-md shadow-[inset_0_0_0_1px_var(--border)]">
                        <ChiefMark className="size-[15px]" />
                      </Swatch>
                      <div className="min-w-0">
                        <b className="flex items-baseline gap-[7px] text-xs font-semibold tracking-[-0.01em]">
                          Chief
                          <em className="text-muted-foreground text-[10px] font-normal not-italic">
                            3:09 pm
                          </em>
                        </b>
                        <p className="text-muted-foreground mt-[3px] text-[12.5px] leading-[1.55]">
                          Hey{" "}
                          <span className="bg-foreground/8 text-foreground inline-flex items-center gap-1 rounded-[5px] py-px pr-1.5 pl-[3px] text-[11.5px] font-medium whitespace-nowrap">
                            <span className="grid size-3.5 place-items-center rounded-[3px] bg-[#7adb9e]">
                              <ChiefMark className="size-2 text-neutral-950" />
                            </span>
                            Marketer
                          </span>{" "}
                          use{" "}
                          <span className="bg-foreground/8 text-foreground inline-flex items-center gap-1 rounded-[5px] py-px pr-1.5 pl-[5px] text-[11.5px] font-medium whitespace-nowrap">
                            <svg
                              aria-hidden="true"
                              className="text-muted-foreground size-[11px] shrink-0"
                              fill="none"
                              stroke="currentColor"
                              strokeLinejoin="round"
                              strokeWidth="1.4"
                              viewBox="0 0 16 16"
                            >
                              <path d="M4 3.2h5.2L12.8 7v5.8H4z" />
                              <path d="M9.2 3.2V7h3.6" />
                            </svg>
                            Build brand profile
                          </span>{" "}
                          to create a working profile from our first-party
                          evidence.
                        </p>
                        <span className="mt-[5px] inline-block text-[11px] font-medium text-[#5b9dd9]">
                          1 reply
                        </span>
                      </div>
                    </div>
                    <div className="flex min-w-0 items-start gap-[9px]">
                      <Swatch className="size-[22px] rounded-md bg-[#7adb9e]">
                        <ChiefMark className="size-[15px] text-neutral-950" />
                      </Swatch>
                      <div className="min-w-0">
                        <b className="flex items-baseline gap-[7px] text-xs font-semibold tracking-[-0.01em]">
                          Marketer
                          <em className="text-muted-foreground text-[10px] font-normal not-italic">
                            3:14 pm
                          </em>
                        </b>
                        <p className="text-muted-foreground mt-[3px] text-[12.5px] leading-[1.55]">
                          Brand profile is ready. The positioning doc is in{" "}
                          <span className="bg-foreground/8 text-foreground inline-flex items-center gap-1 rounded-[5px] py-px pr-1.5 pl-[5px] text-[11.5px] font-medium whitespace-nowrap">
                            <svg
                              aria-hidden="true"
                              className="text-muted-foreground size-[11px] shrink-0"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              viewBox="0 0 16 16"
                            >
                              <rect
                                height="10.2"
                                rx="1.4"
                                width="8.2"
                                x="4.2"
                                y="2.8"
                              />
                              <path d="M3 5.2v7.4A1.6 1.6 0 0 0 4.6 14.2h7.2" />
                            </svg>
                            Files
                          </span>
                          .
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="text-muted-foreground mx-4 mb-4 rounded-[9px] px-3 py-2.5 text-xs shadow-[inset_0_0_0_1px_var(--border)]">
                    Message #marketing…
                  </div>
                </div>
              </div>
            </div>
          </Tile>

          <Tile className="col-span-6 overflow-hidden lg:col-span-2 lg:min-h-[430px]">
            <TileCopy
              body="Bring the ones you already work with. They can run on your machine, or in the cloud."
              title="Invite local and cloud agents."
            />
            <div
              aria-hidden="true"
              className="mt-[18px] h-[260px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,#000_16%,#000_84%,transparent)]"
            >
              <div className="animate-[marquee-y_22s_linear_infinite] motion-reduce:animate-none">
                <AgentTrack />
                <AgentTrack />
              </div>
            </div>
          </Tile>

          <Tile className="col-span-6 lg:col-span-2">
            <TileCopy
              body="Give them a job and a time. They do it every week."
              title="Complete work on a schedule."
            />
            <div aria-hidden="true" className="mt-5 flex flex-1 flex-col">
              {schedule.map((run, index) => (
                <div
                  className={cn(
                    "grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5",
                    index > 0 &&
                      "mt-1 pt-3 shadow-[inset_0_1px_0_var(--border)]",
                  )}
                  key={run.title}
                >
                  <Swatch className={cn("size-8", run.swatch)}>
                    <ChiefMark className="size-[15px] text-neutral-950" />
                  </Swatch>
                  <div className="min-w-0">
                    <b className="block text-[13px] font-medium tracking-[-0.02em]">
                      {run.title}
                    </b>
                    <small className="text-muted-foreground mt-[3px] block text-xs">
                      {run.agent}
                    </small>
                  </div>
                  <em className="text-muted-foreground text-xs whitespace-nowrap not-italic tabular-nums">
                    {run.when}
                  </em>
                </div>
              ))}
            </div>
          </Tile>

          <Tile className="col-span-6 lg:col-span-2">
            <TileCopy
              body="You don’t have to sit in the chat and wait."
              title="They keep working if you aren’t there."
            />
            <div
              aria-hidden="true"
              className="flex flex-1 flex-col justify-center pt-3"
            >
              <div className="text-foreground flex items-center gap-2.5 pb-3 text-[13px]">
                <MatrixLoader
                  className="text-muted-foreground"
                  fps={6}
                  size={15}
                />
                Analyst is writing the weekly brief.
              </div>
              {steps.map((step) => (
                <div
                  className={cn(
                    "flex items-center gap-2 pt-2.5 text-[13px]",
                    step.done ? "text-foreground" : "text-muted-foreground",
                  )}
                  key={step.label}
                >
                  <span
                    className={cn(
                      "size-3 shrink-0 rounded-full",
                      step.done
                        ? "bg-[#7adb9e]"
                        : "shadow-[inset_0_0_0_1.5px_var(--border)]",
                    )}
                  />
                  {step.label}
                </div>
              ))}
            </div>
          </Tile>

          <Tile className="col-span-6 overflow-hidden lg:col-span-2">
            <TileCopy
              body="Your agents work in the tools the work already lives in."
              title="Connects to all of your apps."
            />
            <div
              aria-hidden="true"
              className="relative isolate -mx-7 mt-3.5 mb-4 flex flex-1 flex-col justify-start overflow-hidden py-0.5"
            >
              <div className="from-card to-card pointer-events-none absolute inset-0 z-[2] bg-gradient-to-r via-transparent" />
              <RailsRow
                animation="animate-[marquee_70s_linear_infinite]"
                apps={railsA}
              />
              <RailsRow
                animation="animate-[marquee_78s_linear_infinite] [animation-direction:reverse]"
                apps={railsB}
              />
              <RailsRow
                animation="animate-[marquee_84s_linear_infinite]"
                apps={railsC}
              />
            </div>
          </Tile>

          <article
            className="bg-card col-span-6 grid scroll-mt-7 overflow-hidden rounded-3xl px-12 pt-12 max-lg:px-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-end lg:gap-8"
            id="download"
          >
            <div className="pb-12 max-lg:pb-2">
              <h3 className="text-foreground max-w-[16em] text-[clamp(24px,2.6vw,32px)] leading-[1.14] font-medium tracking-[-0.045em]">
                On your desk and in your pocket.
              </h3>
              <p className="text-muted-foreground mt-3.5 max-w-[30em] text-[15px] leading-[1.6]">
                Mac, Windows, and iPhone. The same workspace, the same channels,
                wherever you pick it up.
              </p>
              <div className="mt-7">
                <GetAppButton />
              </div>
            </div>
            <div
              aria-hidden="true"
              className="flex justify-center overflow-hidden"
            >
              <div className="h-[296px] w-[300px] overflow-hidden rounded-t-[40px] border border-b-0 border-[#777] bg-[#141416] p-[7px] shadow-[0_20px_55px_#0005]">
                <Image
                  alt=""
                  className="h-auto w-full rounded-[33px]"
                  height={2868}
                  src="/landing/iphone.png"
                  width={1320}
                />
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
