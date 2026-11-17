import { z } from "zod";

/**
 * Teammates offered during setup. `apps` are the catalog plugins each one
 * works best with, shown on its card and suggested in its first message.
 */
export const onboardingAgents = [
  {
    id: "researcher",
    name: "Researcher",
    role: "Research",
    description: "Find answers and compare options.",
    color: "#7dc7fa",
    purpose: "personal",
    apps: [
      { slug: "exa-ai", name: "Exa" },
      { slug: "firecrawl-dev", name: "Firecrawl" },
      { slug: "notion-com", name: "Notion" },
    ],
  },
  {
    id: "planner",
    name: "Planner",
    role: "Planning",
    description: "Turn priorities into practical plans.",
    color: "#61dbe8",
    purpose: "personal",
    apps: [
      { slug: "notion-com", name: "Notion" },
      { slug: "todoist-com", name: "Todoist" },
      { slug: "asana", name: "Asana" },
    ],
  },
  {
    id: "writer",
    name: "Writer",
    role: "Writing",
    description: "Help with drafts and everyday writing.",
    color: "#fcc24d",
    purpose: "personal",
    apps: [
      { slug: "notion-com", name: "Notion" },
      { slug: "exa-ai", name: "Exa" },
      { slug: "dropbox", name: "Dropbox" },
    ],
  },
  {
    id: "brand",
    name: "Marketer",
    role: "Marketing",
    description: "Help with your brand and content.",
    color: "#7adb9e",
    purpose: "company",
    apps: [
      { slug: "hubspot", name: "HubSpot" },
      { slug: "intuit-mailchimp", name: "Mailchimp" },
      { slug: "ahrefs", name: "Ahrefs" },
    ],
  },
  {
    id: "content",
    name: "Content Writer",
    role: "Content & Social",
    description: "Draft content and social posts.",
    color: "#fcc24d",
    purpose: "company",
    apps: [
      { slug: "notion-com", name: "Notion" },
      { slug: "canva", name: "Canva" },
      { slug: "webflow", name: "Webflow" },
    ],
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Analytics & Reporting",
    description: "Make sense of metrics and performance.",
    color: "#61dbe8",
    purpose: "company",
    apps: [
      { slug: "posthog-com", name: "PostHog" },
      { slug: "mixpanel", name: "Mixpanel" },
      { slug: "stripe-com", name: "Stripe" },
    ],
  },
  {
    id: "prospector",
    name: "Prospector",
    role: "Research and Outreach",
    description: "Research potential customers.",
    color: "#7dc7fa",
    purpose: "company",
    apps: [
      { slug: "apollo", name: "Apollo.io" },
      { slug: "hubspot", name: "HubSpot" },
      { slug: "similarweb", name: "Similarweb" },
    ],
  },
  {
    id: "ads",
    name: "Ads Manager",
    role: "Paid Acquisition",
    description: "Review campaigns and creative.",
    color: "#fa8ca8",
    purpose: "company",
    apps: [
      { slug: "similarweb", name: "Similarweb" },
      { slug: "posthog-com", name: "PostHog" },
      { slug: "amplitude", name: "Amplitude" },
    ],
  },
  {
    id: "engineer",
    name: "Engineer",
    role: "Product Engineering",
    description: "Support product and technical work.",
    color: "#fa9c57",
    purpose: "company",
    apps: [
      { slug: "github-com", name: "GitHub" },
      { slug: "linear-app", name: "Linear" },
      { slug: "vercel-com", name: "Vercel" },
    ],
  },
] as const;

export type WorkspacePurpose = "personal" | "company";
export type OnboardingAgentId = (typeof onboardingAgents)[number]["id"];
const [firstAgent, ...otherAgents] = onboardingAgents;
export const onboardingAgentIds: [OnboardingAgentId, ...OnboardingAgentId[]] = [
  firstAgent.id,
  ...otherAgents.map((agent) => agent.id),
];

/** A teammate's name as a person may set it during setup. */
export const onboardingAgentNameSchema = z.string().trim().min(1).max(40);
export function suggestedAgentIds(purpose: WorkspacePurpose) {
  return onboardingAgents
    .filter((agent) => agent.purpose === purpose && agent.id !== "writer")
    .map((agent) => agent.id);
}
export function workspaceSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
