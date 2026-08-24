import type { SimpleIcon } from "simple-icons";
import {
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  MessageCircle,
  Search,
  Twitter,
  Youtube,
} from "lucide-react";
import { siInstagram, siReddit, siTiktok, siX, siYoutube } from "simple-icons";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";

import type { IntegrationSearchResult } from "../lib/integrations";
import type { OnboardingStep } from "../lib/onboarding-flow";
import type { SocialPlatform } from "../lib/social-platforms";
import { ONBOARDING_STEPS } from "../lib/onboarding-flow";
import { pluginDomain } from "../lib/plugin-presentation";

export type StepKey = OnboardingStep;

export const steps = ONBOARDING_STEPS;

export const questions: Record<StepKey, string> = {
  mode: "First, where should this workspace run?",
  inference: "Which agent app should Chief use?",
  health: "Quick check before we teach Chief about your business.",
  context:
    "I'll set this workspace up around one company, so the agents know exactly who they're working for. What's your company and website?",
  brand:
    "How should Chief learn your brand voice and visual guidelines for the initial review?",
  socials:
    "Nice. Now add the public accounts the agents should learn from and write for.",
  selling: "Describe what you're selling in a few short words.",
  audience: "Who is your ideal customer?",
  success: "What would make the next 90 days feel like this is working?",
  time: "How much time can you spend on marketing each week?",
  monitoring:
    "Where should your agents proactively search for prospects, buying signals and relevant conversations?",
  plugins: "What apps do you already use?",
  automation:
    "Here is the recurring work I recommend starting with. Review the schedule, then activate what you want.",
  finish: "You're in.",
};

export const successOptions = [
  "First paying customers",
  "Steady qualified leads",
  "A repeatable content rhythm",
  "$5k MRR with signal",
  "10 serious customer calls",
  "Repeatable acquisition channel",
];

export const timeOptions = [
  "0-2 hours",
  "2-5 hours",
  "5-10 hours",
  "10-20 hours",
  "20+ hours",
];

export const weekDays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const scheduleTimeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  const label = new Date(2000, 0, 1, hour, Number(minute)).toLocaleTimeString(
    [],
    { hour: "numeric", minute: "2-digit" },
  );
  return { value, label };
});

export const monitoringOptions = [
  { key: "x", label: "X", platform: "x" as const, Icon: Twitter },
  { key: "facebook", label: "Facebook", Icon: Facebook },
  {
    key: "instagram",
    label: "Instagram",
    platform: "instagram" as const,
    Icon: Instagram,
  },
  {
    key: "reddit",
    label: "Reddit",
    platform: "reddit" as const,
    Icon: MessageCircle,
  },
  { key: "linkedin", label: "LinkedIn", Icon: Linkedin },
  {
    key: "youtube",
    label: "YouTube",
    platform: "youtube" as const,
    Icon: Youtube,
  },
  { key: "search", label: "Search", Icon: Search },
  { key: "communities", label: "Communities", Icon: Globe },
];

export const fallbackEverydayIntegrations = (
  [
    ["workspace.google.com", "Google Workspace"],
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
    ["hubspot.com", "HubSpot"],
    ["salesforce.com", "Salesforce"],
    ["linkedin.com", "LinkedIn"],
    ["zoom.com", "Zoom"],
    ["canva.com", "Canva"],
    ["asana.com", "Asana"],
    ["airtable.com", "Airtable"],
    ["clickup.com", "ClickUp"],
    ["monday.com", "monday.com"],
    ["intercom.com", "Intercom"],
    ["convex.dev", "Convex"],
    ["box.com", "Box"],
    ["miro.com", "Miro"],
    ["resend.com", "Resend"],
    ["sentry.io", "Sentry"],
    ["supabase.com", "Supabase"],
    ["stripe.com", "Stripe"],
    ["clay.com", "Clay"],
    ["apollo.io", "Apollo.io"],
    ["fireflies.ai", "Fireflies"],
    ["webflow.com", "Webflow"],
    ["cloudflare.com", "Cloudflare"],
    ["calendly.com", "Calendly"],
  ] as const
).map(([domain, name]): IntegrationSearchResult => ({
  domain,
  name,
  description: `${name} connection`,
  kinds: ["mcp"],
  url: `https://integrations.sh/${domain}/`,
}));
export const preferredEverydayIntegrations = fallbackEverydayIntegrations.slice(
  0,
  30,
);

export function integrationDomainKey(domain: string) {
  if (domain === "notion.so") return "notion.com";
  if (domain === "zoom.us") return "zoom.com";
  return domain;
}

export function pluginIntegration(
  plugin: AgentPluginSummary,
): IntegrationSearchResult {
  const domain = pluginDomain(plugin);
  return {
    domain,
    name: plugin.name,
    description: plugin.description,
    kinds: [
      plugin.source.type === "discovery"
        ? "mcp"
        : plugin.source.type === "setup"
          ? "setup"
          : "plugin",
    ],
    url: plugin.homepage ?? `https://integrations.sh/${domain}/`,
  };
}

export const socialIcons: Partial<Record<SocialPlatform, SimpleIcon>> = {
  x: siX,
  instagram: siInstagram,
  tiktok: siTiktok,
  reddit: siReddit,
  youtube: siYoutube,
};
