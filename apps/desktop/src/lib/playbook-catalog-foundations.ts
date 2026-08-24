import type { IntegrationDependency, PlaybookCategory } from "./playbook-types";

export const PLAYBOOK_CATEGORIES: PlaybookCategory[] = [
  "Find customers",
  "Content",
  "Search",
  "Conversion",
  "Research",
];

export const INTEGRATIONS = {
  analytics: {
    domain: "analytics.googleapis.com",
    label: "Google Analytics",
    access: "connected",
  },
  posthog: { domain: "posthog.com", label: "PostHog", access: "connected" },
  github: { domain: "github.com", label: "GitHub", access: "connected" },
  vercel: { domain: "vercel.com", label: "Vercel", access: "connected" },
  reddit: { domain: "reddit.com", label: "Reddit", access: "public" },
  hackerNews: {
    domain: "news.ycombinator.com",
    label: "Hacker News",
    access: "public",
  },
  x: { domain: "x.com", label: "X", access: "public" },
  linkedin: { domain: "linkedin.com", label: "LinkedIn", access: "public" },
  facebook: {
    domain: "facebook.com",
    label: "Facebook",
    access: "connected",
    note: "Page and approved public-content access only",
  },
  instagram: {
    domain: "instagram.com",
    label: "Instagram",
    access: "connected",
    note: "Professional-account comments, mentions, hashtags, and insights",
  },
  tiktok: {
    domain: "tiktok.com",
    label: "TikTok",
    access: "connected",
    note: "Owned-account data; broad public research requires separate eligibility",
  },
  youtube: { domain: "youtube.com", label: "YouTube", access: "connected" },
  gmail: {
    domain: "gmail.googleapis.com",
    label: "Gmail",
    access: "connected",
  },
  hubspot: { domain: "api.hubapi.com", label: "HubSpot", access: "connected" },
  productHunt: {
    domain: "api.producthunt.com",
    label: "Product Hunt",
    access: "public",
  },
  searchConsole: {
    domain: "searchconsole.googleapis.com",
    label: "Google Search Console",
    access: "connected",
  },
  semrush: { domain: "semrush.com", label: "Semrush", access: "connected" },
  openai: { domain: "openai.com", label: "OpenAI", access: "connected" },
  perplexity: {
    domain: "perplexity.ai",
    label: "Perplexity",
    access: "connected",
  },
  anthropic: {
    domain: "anthropic.com",
    label: "Anthropic",
    access: "connected",
  },
  googleAds: {
    domain: "googleads.googleapis.com",
    label: "Google Ads",
    access: "connected",
  },
  meta: {
    domain: "graph.facebook.com",
    label: "Meta Ads",
    access: "connected",
  },
  linkedInAds: {
    domain: "linkedin.com",
    label: "LinkedIn Ads",
    access: "connected",
  },
  tiktokAds: {
    domain: "ads.tiktok.com",
    label: "TikTok Ads",
    access: "connected",
  },
} satisfies Record<string, IntegrationDependency>;

export const sharedGuardrails = [
  "Use evidence from connected sources. Label assumptions and data gaps clearly.",
  "Never imply a platform was searched comprehensively when access is limited to owned accounts, approved endpoints, or visible public pages.",
  "Do not publish, send messages, change spend, or edit external records without approval.",
  "Prefer a few high-confidence findings over a long list of generic suggestions.",
];
