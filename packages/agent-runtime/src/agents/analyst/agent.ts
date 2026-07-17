import type { AgentManifest } from "../manifest.js";

export const analyst = {
  id: "analyst",
  name: "Analyst",
  role: "Analytics & Reporting",
  description:
    "Reviews website traffic, signups, SEO, funnels and content performance across connected channels.",
  capabilities: ["analytics-chart"],
} satisfies AgentManifest;
