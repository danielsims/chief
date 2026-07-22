import type { IntegrationSearchResult } from "./integrations";

export interface CatalogIntegration extends IntegrationSearchResult {
  provider: string;
}

export interface IntegrationCatalogGroup {
  category: string;
  integrations: CatalogIntegration[];
}

export const INTEGRATION_CATALOG: IntegrationCatalogGroup[] = [
  {
    category: "Analytics",
    integrations: [
      {
        provider: "google-analytics",
        domain: "analytics.googleapis.com",
        name: "Google Analytics",
        description: "GA4 acquisition, traffic, and conversion reporting.",
        kinds: ["oauth", "api"],
        url: "https://integrations.sh/analytics.googleapis.com/",
      },
      {
        provider: "posthog.com",
        domain: "posthog.com",
        name: "PostHog",
        description: "Product analytics, funnels, and event data.",
        kinds: ["mcp", "api"],
        url: "https://integrations.sh/posthog.com/",
      },
      {
        provider: "mixpanel.com",
        domain: "mixpanel.com",
        name: "Mixpanel",
        description: "Product behavior, cohorts, and retention.",
        kinds: ["mcp", "api"],
        url: "https://integrations.sh/mixpanel.com/",
      },
    ],
  },
  {
    category: "Advertising",
    integrations: [
      {
        provider: "google-ads",
        domain: "googleads.googleapis.com",
        name: "Google Ads",
        description: "Campaign performance and conversion data.",
        kinds: ["oauth", "api"],
        url: "https://integrations.sh/googleads.googleapis.com/",
      },
      {
        provider: "meta",
        domain: "facebook.com",
        name: "Meta Ads",
        description: "Campaign, ad set, and creative performance.",
        kinds: ["oauth", "api"],
        url: "https://integrations.sh/facebook.com/",
      },
      {
        provider: "api.linkedin.com",
        domain: "api.linkedin.com",
        name: "LinkedIn Ads",
        description: "B2B campaign and audience reporting.",
        kinds: ["oauth", "api"],
        url: "https://integrations.sh/api.linkedin.com/",
      },
    ],
  },
  {
    category: "Website & deployment",
    integrations: [
      {
        provider: "github.com",
        domain: "github.com",
        name: "GitHub",
        description: "Repository access, pull requests, and releases.",
        kinds: ["oauth", "mcp"],
        url: "https://integrations.sh/github.com/",
      },
      {
        provider: "vercel.com",
        domain: "vercel.com",
        name: "Vercel",
        description: "Projects, deployments, domains, and configuration.",
        kinds: ["oauth", "mcp"],
        url: "https://integrations.sh/vercel.com/",
      },
    ],
  },
];

export const ENGINEERING_INTEGRATIONS =
  INTEGRATION_CATALOG.find((group) => group.category === "Website & deployment")
    ?.integrations ?? [];
