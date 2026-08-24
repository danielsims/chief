import assert from "node:assert/strict";
import test from "node:test";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";

import {
  comparePluginPresentation,
  featuredPluginOptions,
  onboardingPluginOptions,
  pluginCategoryLabel,
  pluginDomain,
} from "../src/lib/plugin-presentation.js";

function plugin(
  id: string,
  name: string,
  domain: string | undefined,
  category: string,
  description: string,
): AgentPluginSummary {
  return {
    id,
    name,
    description,
    category,
    ...(domain ? { domains: [domain] } : undefined),
    source: {
      type: "git",
      url: `https://github.com/example/${id}`,
      sha: "a".repeat(40),
    },
    status: "available",
    enabled: false,
    trusted: false,
  };
}

void test("normalizes coarse catalog tags using the app's actual purpose", () => {
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "posthog",
        "PostHog",
        "posthog.com",
        "code",
        "Product analytics, feature flags, experiments, and insights.",
      ),
    ),
    "Data & Analytics",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "figma",
        "Figma",
        "figma.com",
        "development",
        "Design context and design-to-code workflows.",
      ),
    ),
    "Design",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "slack",
        "Slack",
        "slack.com",
        "productivity",
        "Search channels and team conversations.",
      ),
    ),
    "Communication",
  );
});

void test("groups plugins by the operational team that would use them", () => {
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "semrush",
        "Semrush",
        "semrush.com",
        "business",
        "SEO research and content marketing campaigns.",
      ),
    ),
    "Marketing",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "hubspot",
        "HubSpot",
        "hubspot.com",
        "sales",
        "CRM contacts, deals, and pipeline.",
      ),
    ),
    "Sales",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "zendesk",
        "Zendesk",
        "zendesk.com",
        "business",
        "Customer support inbox and ticketing.",
      ),
    ),
    "Support",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "github",
        "GitHub",
        "github.com",
        "development",
        "Repositories, issues, and pull requests.",
      ),
    ),
    "Engineering",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "supabase",
        "Supabase",
        "supabase.com",
        "code",
        "Design schemas and manage PostgreSQL databases.",
      ),
    ),
    "Engineering",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "intercom",
        "Intercom",
        "intercom.com",
        "communication",
        "Customer conversations and support tickets.",
      ),
    ),
    "Support",
  );
  assert.equal(
    pluginCategoryLabel(
      plugin(
        "adobe-marketing",
        "Adobe Marketing Agent",
        "adobe.io",
        "sales-and-marketing",
        "Campaign insights and marketing actions.",
      ),
    ),
    "Marketing",
  );
});

void test("features the curated product integrations without provider aliases", () => {
  const domains = [
    "workspace.google.com",
    "gmail.googleapis.com",
    "slack.com",
    "notion.com",
    "notion.so",
    "granola.ai",
    "vercel.com",
    "linear.app",
    "atlassian.com",
    "posthog.com",
    "hubspot.com",
    "figma.com",
    "canva.com",
    "intercom.com",
    "intercom.io",
    "supabase.com",
    "stripe.com",
    "airtable.com",
    "zoom.com",
    "clay.com",
    "asana.com",
    "monday.com",
    "ramp.com",
    "brex.com",
    "airops.com",
  ];
  const candidates = domains.map((domain) =>
    plugin(
      domain === "workspace.google.com" ? "google-workspace" : domain,
      domain,
      domain,
      "productivity",
      "A useful integration.",
    ),
  );

  assert.deepEqual(
    featuredPluginOptions(candidates).map((candidate) =>
      pluginDomain(candidate),
    ),
    [
      "workspace.google.com",
      "slack.com",
      "notion.com",
      "granola.ai",
      "vercel.com",
      "linear.app",
      "posthog.com",
      "hubspot.com",
      "figma.com",
      "canva.com",
      "intercom.com",
      "supabase.com",
      "stripe.com",
      "clay.com",
      "asana.com",
      "monday.com",
      "ramp.com",
      "brex.com",
    ],
  );
});

void test("orders categories by product rank and then catalog popularity", () => {
  const mailchimp = plugin(
    "mailchimp",
    "Intuit Mailchimp",
    "mailchimp.com",
    "productivity",
    "Email marketing campaigns.",
  );
  const airOps = plugin(
    "airops",
    "AirOps",
    "airops.com",
    "productivity",
    "AEO analytics.",
  );
  mailchimp.popularity = 15_434;
  airOps.popularity = 14_767;
  assert.ok(comparePluginPresentation(mailchimp, airOps) < 0);

  const popular = plugin(
    "popular",
    "Popular",
    "popular.example",
    "productivity",
    "Tasks.",
  );
  const niche = plugin(
    "niche",
    "Niche",
    "niche.example",
    "productivity",
    "Tasks.",
  );
  popular.popularity = 100;
  niche.popularity = 10;
  assert.ok(comparePluginPresentation(popular, niche) < 0);
});

void test("keeps preferred apps first and excludes domainless skill packages", () => {
  const options = onboardingPluginOptions([
    plugin("figma", "Figma", "figma.com", "development", "Design files"),
    plugin("slack", "Slack", "slack.com", "productivity", "Messages"),
    plugin("granola", "Granola", "granola.ai", "productivity", "Meetings"),
    plugin("skill", "A coding skill", undefined, "development", "Code well"),
  ]);

  assert.deepEqual(
    options.map((candidate) => candidate.id),
    ["slack", "granola", "figma"],
  );
  const first = options[0];
  assert.ok(first);
  assert.equal(pluginDomain(first), "slack.com");
});

void test("uses declared provider domains instead of a git repository host", () => {
  const vercel = plugin(
    "vercel",
    "Vercel",
    "vercel.com",
    "deployment",
    "Build and deploy apps.",
  );
  vercel.homepage = "https://github.com/vercel/vercel";

  assert.equal(pluginDomain(vercel), "vercel.com");
});
