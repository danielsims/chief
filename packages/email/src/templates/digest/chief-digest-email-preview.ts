import type { ChiefDigestEmailProps } from "./chief-digest-email";
import { PREVIEW_EMAIL_LOGO_URL } from "../../branding";

const googleAnalytics = {
  name: "Google Analytics",
  domain: "analytics.googleapis.com",
};
const posthog = { name: "PostHog", domain: "posthog.com" };
const reddit = { name: "Reddit", domain: "reddit.com" };
const x = { name: "X", domain: "x.com" };
const linkedIn = { name: "LinkedIn", domain: "linkedin.com" };
const facebook = { name: "Facebook", domain: "facebook.com" };
const instagram = { name: "Instagram", domain: "instagram.com" };
const tiktok = { name: "TikTok", domain: "tiktok.com" };
const youtube = { name: "YouTube", domain: "youtube.com" };

export const digestPreviewProps = {
  firstName: "Alex",
  frequency: "weekly",
  periodLabel: "7–13 July 2026",
  logoUrl: PREVIEW_EMAIL_LOGO_URL,
  completedWork: [
    {
      id: "growth-report",
      agentName: "Analyst",
      title: "Weekly growth report",
      summary:
        "Compared the latest complete period with the previous one and saved the report with two charts.",
      integrations: [googleAnalytics, posthog],
    },
    {
      id: "buying-signals",
      agentName: "Prospector",
      title: "Find buying signals",
      summary:
        "Saved eight new prospects and three relevant trends to the workspace for review.",
      integrations: [reddit, x, linkedIn, facebook, instagram, tiktok],
    },
    {
      id: "founder-content",
      agentName: "Content Writer",
      title: "Founder content",
      summary:
        "Prepared three drafts from recent product work. Nothing was published.",
      integrations: [googleAnalytics, x, linkedIn, instagram, tiktok, youtube],
    },
  ],
  actionItems: [
    {
      id: "connect-google-analytics",
      agentName: "Setup",
      title: "Finish Google Analytics setup",
      reason:
        "Sign in once so Analyst can create read-only reports from the connected property.",
      integrations: [googleAnalytics],
    },
  ],
  upcomingWork: [
    {
      id: "next-buying-signals",
      agentName: "Prospector",
      title: "Find buying signals",
      nextAtLabel: "Tomorrow at 9:00 am",
      timezone: "Australia/Brisbane",
      integrations: [reddit, x, linkedIn, facebook, instagram, tiktok],
    },
    {
      id: "next-growth-report",
      agentName: "Analyst",
      title: "Weekly growth report",
      nextAtLabel: "Saturday at 1:10 pm",
      timezone: "Australia/Brisbane",
      integrations: [googleAnalytics, posthog],
    },
  ],
  workspaceRecords: {
    newProspects: 8,
    newTrends: 3,
    draftsReady: 3,
  },
} satisfies ChiefDigestEmailProps;
