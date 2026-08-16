import type { AgentPluginSummary } from "@chief/agent-runtime/types";

export const PLUGIN_CATEGORY_ORDER = [
  "Featured",
  "Marketing",
  "Sales",
  "Support",
  "Engineering",
  "Data & Analytics",
  "Productivity",
  "Communication",
  "Design",
  "Finance",
  "Health & Science",
  "Other",
] as const;

const featuredDomainPriority = [
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
] as const;

const catalogDomainPriority = [
  ...featuredDomainPriority,
  "airtable.com",
  "zoom.com",
  "sentry.io",
  "cloudflare.com",
  "mixpanel.com",
  "mailchimp.com",
  "salesforce.com",
  "zendesk.com",
  "clickup.com",
  "box.com",
  "miro.com",
  "gamma.app",
  "excalidraw.com",
  "webflow.com",
  "ahrefs.com",
  "klaviyo.com",
  "similarweb.com",
  "semrush.com",
  "supermetrics.com",
  "apollo.io",
  "attio.com",
  "outreach.io",
  "zoominfo.com",
  "commonroom.io",
  "g2.com",
  "usepylon.com",
  "devrev.ai",
  "unthread.io",
  "postman.com",
  "context7.com",
  "pagerduty.com",
  "incident.io",
  "netlify-mcp.netlify.app",
  "fireflies.ai",
  "fathom.ai",
  "calendly.com",
  "superhuman.com",
  "bigquery.googleapis.com",
  "pendo.io",
  "hex.tech",
  "pscale.dev",
  "ramp.com",
  "brex.com",
  "paypal.com",
] as const;

const featuredRank = new Map<string, number>(
  featuredDomainPriority.map((domain, index) => [domain, index]),
);
const catalogRank = new Map<string, number>(
  catalogDomainPriority.map((domain, index) => [domain, index]),
);

const providerDomainAliases: Record<string, string> = {
  "gmail.googleapis.com": "workspace.google.com",
  "intercom.io": "intercom.com",
  "notion.so": "notion.com",
  "zoom.us": "zoom.com",
};

const categoryByDomain: Record<string, string> = {
  "ahrefs.com": "Marketing",
  "airtable.com": "Productivity",
  "apollo.io": "Sales",
  "asana.com": "Productivity",
  "atlassian.com": "Engineering",
  "bigquery.googleapis.com": "Data & Analytics",
  "box.com": "Productivity",
  "brex.com": "Finance",
  "calendly.com": "Communication",
  "canva.com": "Design",
  "clay.com": "Sales",
  "clickup.com": "Productivity",
  "cloudflare.com": "Engineering",
  "commonroom.io": "Sales",
  "context7.com": "Engineering",
  "devrev.ai": "Support",
  "excalidraw.com": "Design",
  "fathom.ai": "Communication",
  "figma.com": "Design",
  "fireflies.ai": "Communication",
  "g2.com": "Sales",
  "gamma.app": "Design",
  "github.com": "Engineering",
  "gmail.googleapis.com": "Communication",
  "workspace.google.com": "Communication",
  "granola.ai": "Communication",
  "hubspot.com": "Sales",
  "incident.io": "Engineering",
  "intercom.com": "Support",
  "klaviyo.com": "Marketing",
  "linear.app": "Engineering",
  "mailchimp.com": "Marketing",
  "miro.com": "Design",
  "mixpanel.com": "Data & Analytics",
  "monday.com": "Productivity",
  "netlify-mcp.netlify.app": "Engineering",
  "notion.com": "Productivity",
  "notion.so": "Productivity",
  "outreach.io": "Sales",
  "pagerduty.com": "Engineering",
  "paypal.com": "Finance",
  "pendo.io": "Data & Analytics",
  "posthog.com": "Data & Analytics",
  "postman.com": "Engineering",
  "ramp.com": "Finance",
  "salesforce.com": "Sales",
  "semrush.com": "Marketing",
  "sentry.io": "Engineering",
  "similarweb.com": "Marketing",
  "slack.com": "Communication",
  "stripe.com": "Finance",
  "superhuman.com": "Communication",
  "supermetrics.com": "Data & Analytics",
  "supabase.com": "Engineering",
  "unthread.io": "Support",
  "usepylon.com": "Support",
  "vercel.com": "Engineering",
  "webflow.com": "Design",
  "zendesk.com": "Support",
  "zoom.com": "Communication",
  "zoominfo.com": "Sales",
};

const categoryAliases: Record<string, string> = {
  analytics: "Data & Analytics",
  api: "Engineering",
  automation: "Productivity",
  business: "Productivity",
  code: "Engineering",
  communication: "Communication",
  creative: "Design",
  data: "Data & Analytics",
  database: "Data & Analytics",
  deployment: "Engineering",
  design: "Design",
  development: "Engineering",
  "financial-services": "Finance",
  health: "Health & Science",
  "life-sciences": "Health & Science",
  marketing: "Marketing",
  monitoring: "Engineering",
  observability: "Engineering",
  productivity: "Productivity",
  sales: "Sales",
  "sales-and-marketing": "Sales",
  site: "Engineering",
  website: "Engineering",
  "write code": "Engineering",
  "write copy": "Marketing",
};

const inferredCategories: { label: string; pattern: RegExp }[] = [
  {
    label: "Support",
    pattern:
      /\b(?:customer support|customer service|help ?desk|support inbox|support ticket|ticketing)\b/i,
  },
  {
    label: "Marketing",
    pattern:
      /\b(?:marketing|campaign|advertising|ads|seo|social media|content marketing|brand|audience|growth marketing)\b/i,
  },
  {
    label: "Sales",
    pattern:
      /\b(?:sales|crm|leads?|prospects?|outreach|deals?|pipeline|revenue intelligence)\b/i,
  },
  {
    label: "Design",
    pattern: /\b(?:design|creative|prototype|whiteboard|brand asset|visual)\b/i,
  },
  {
    label: "Finance",
    pattern: /\b(?:payment|billing|banking|finance|accounting|invoice)\b/i,
  },
  {
    label: "Health & Science",
    pattern: /\b(?:health|medical|clinical|science|research paper)\b/i,
  },
  {
    label: "Data & Analytics",
    pattern:
      /\b(?:analytics|business intelligence|insights?|warehouse|data platform|experiments?)\b/i,
  },
  {
    label: "Engineering",
    pattern:
      /\b(?:code|deploy|developer|software|repository|pull request|issues?|infrastructure|observability|error monitoring|api|database)\b/i,
  },
  {
    label: "Communication",
    pattern:
      /\b(?:chat|messages?|meetings?|email|calendar|conversations?|transcripts?|video calls?)\b/i,
  },
  {
    label: "Productivity",
    pattern:
      /\b(?:documents?|knowledge|notes?|tasks?|project management|files?|workspace|automation)\b/i,
  },
];

const onboardingDomainPriority = [
  "workspace.google.com",
  "slack.com",
  "granola.ai",
  "notion.com",
  "notion.so",
  "github.com",
  "vercel.com",
  "pscale.dev",
  "posthog.com",
  "linear.app",
  "atlassian.com",
  "figma.com",
  "hubspot.com",
  "canva.com",
  "zoom.com",
  "asana.com",
  "airtable.com",
  "clickup.com",
  "monday.com",
  "intercom.com",
  "convex.dev",
  "box.com",
  "miro.com",
  "resend.com",
  "sentry.io",
  "supabase.com",
  "stripe.com",
  "clay.com",
  "apollo.io",
  "fireflies.ai",
  "webflow.com",
  "cloudflare.com",
  "calendly.com",
];
const onboardingPriority = new Map(
  onboardingDomainPriority.map((domain, index) => [domain, index]),
);

export function pluginDomain(plugin: AgentPluginSummary) {
  if (plugin.source.type === "discovery" || plugin.source.type === "setup") {
    return plugin.source.domain;
  }
  const declared = plugin.domains?.find(Boolean);
  if (declared) return declared.replace(/^www\./, "");
  try {
    return plugin.homepage
      ? new URL(plugin.homepage).hostname.replace(/^www\./, "")
      : plugin.id;
  } catch {
    return plugin.id;
  }
}

export function pluginCategoryLabel(plugin: AgentPluginSummary) {
  const domainCategory = categoryByDomain[pluginDomain(plugin)];
  if (domainCategory) return domainCategory;
  const text = [
    plugin.name,
    plugin.description,
    plugin.category,
    ...(plugin.keywords ?? []),
  ].join(" ");
  const inferred = inferredCategories.find(({ pattern }) => pattern.test(text));
  if (inferred) return inferred.label;
  const category = plugin.category.trim().toLowerCase();
  return (
    categoryAliases[category] ??
    (category
      ? category
          .split(/[-_]/)
          .filter(Boolean)
          .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
          .join(" ")
      : "Other")
  );
}

export function pluginProviderKey(plugin: AgentPluginSummary) {
  const domain = pluginDomain(plugin);
  return providerDomainAliases[domain] ?? domain;
}

export function comparePluginPresentation(
  left: AgentPluginSummary,
  right: AgentPluginSummary,
) {
  const leftRank = catalogRank.get(pluginProviderKey(left));
  const rightRank = catalogRank.get(pluginProviderKey(right));
  return (
    (leftRank ?? Number.MAX_SAFE_INTEGER) -
      (rightRank ?? Number.MAX_SAFE_INTEGER) ||
    (right.popularity ?? 0) - (left.popularity ?? 0) ||
    Number(Boolean(right.featured)) - Number(Boolean(left.featured)) ||
    left.name.localeCompare(right.name)
  );
}

export function featuredPluginOptions(
  plugins: readonly AgentPluginSummary[],
  limit = 18,
) {
  const byDomain = new Map<string, AgentPluginSummary>();
  for (const plugin of plugins) {
    const domain = pluginProviderKey(plugin);
    const current = byDomain.get(domain);
    if (
      featuredRank.has(domain) &&
      (!current || plugin.id === "google-workspace")
    ) {
      byDomain.set(domain, plugin);
    }
  }
  return [...byDomain.values()]
    .sort((left, right) => {
      const leftRank = featuredRank.get(pluginProviderKey(left)) ?? 0;
      const rightRank = featuredRank.get(pluginProviderKey(right)) ?? 0;
      return leftRank - rightRank || left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

function categoryRank(plugin: AgentPluginSummary) {
  const index = PLUGIN_CATEGORY_ORDER.indexOf(
    pluginCategoryLabel(plugin) as (typeof PLUGIN_CATEGORY_ORDER)[number],
  );
  return index >= 0 ? index : PLUGIN_CATEGORY_ORDER.length;
}

/** A balanced, app-only subset of the live catalog for onboarding. */
export function onboardingPluginOptions(
  plugins: readonly AgentPluginSummary[],
  limit = 30,
) {
  const byDomain = new Map<string, AgentPluginSummary>();
  for (const plugin of plugins) {
    const domain = pluginDomain(plugin);
    if (
      !domain.includes(".") ||
      (!plugin.domains?.length &&
        plugin.source.type !== "discovery" &&
        plugin.source.type !== "setup")
    ) {
      continue;
    }
    const current = byDomain.get(domain);
    if (!current || (plugin.featured && !current.featured)) {
      byDomain.set(domain, plugin);
    }
  }
  return [...byDomain.values()]
    .sort((left, right) => {
      const leftPriority = onboardingPriority.get(pluginDomain(left));
      const rightPriority = onboardingPriority.get(pluginDomain(right));
      return (
        (leftPriority ?? Number.MAX_SAFE_INTEGER) -
          (rightPriority ?? Number.MAX_SAFE_INTEGER) ||
        Number(Boolean(right.featured)) - Number(Boolean(left.featured)) ||
        categoryRank(left) - categoryRank(right) ||
        left.name.localeCompare(right.name)
      );
    })
    .slice(0, limit);
}
