import type { AgentPluginSummary } from "@chief/agent-runtime/types";

export const PLUGIN_CATEGORY_ORDER = [
  "Featured",
  "Productivity",
  "Communication",
  "Engineering",
  "Sales & Marketing",
  "Data & Analytics",
  "Design & Creative",
  "Finance",
  "Health & Science",
  "Other",
] as const;

const categoryAliases: Record<string, string> = {
  analytics: "Data & Analytics",
  api: "Engineering",
  automation: "Productivity",
  business: "Productivity",
  code: "Engineering",
  communication: "Communication",
  creative: "Design & Creative",
  data: "Data & Analytics",
  database: "Data & Analytics",
  deployment: "Engineering",
  design: "Design & Creative",
  development: "Engineering",
  "financial-services": "Finance",
  health: "Health & Science",
  "life-sciences": "Health & Science",
  marketing: "Sales & Marketing",
  monitoring: "Engineering",
  observability: "Engineering",
  productivity: "Productivity",
  sales: "Sales & Marketing",
  "sales-and-marketing": "Sales & Marketing",
  site: "Engineering",
  website: "Engineering",
  "write code": "Engineering",
  "write copy": "Sales & Marketing",
};

const inferredCategories: { label: string; pattern: RegExp }[] = [
  {
    label: "Design & Creative",
    pattern: /\b(?:design|creative|prototype|whiteboard|brand asset|visual)\b/i,
  },
  {
    label: "Communication",
    pattern:
      /\b(?:chat|messages?|meetings?|email|calendar|conversations?|transcripts?)\b/i,
  },
  {
    label: "Sales & Marketing",
    pattern:
      /\b(?:crm|sales|marketing|campaign|prospect|customer lifecycle|seo)\b/i,
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
      /\b(?:analytics|insight|warehouse|database|data platform|experiment)\b/i,
  },
  {
    label: "Engineering",
    pattern:
      /\b(?:code|deploy|developer|repository|infrastructure|error monitoring|api)\b/i,
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
