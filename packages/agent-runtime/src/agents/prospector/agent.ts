import type { AgentManifest } from "../manifest.js";

export const prospector = {
  id: "prospector",
  name: "Prospector",
  role: "Prospecting & Trends",
  description:
    "Finds new prospects and trending conversations worth joining across Twitter, Reddit and other channels.",
  capabilities: ["prospect-memory", "trend-memory"],
} satisfies AgentManifest;
