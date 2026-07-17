import type { AgentManifest } from "../manifest.js";

export const cmo = {
  id: "cmo",
  name: "CMO",
  role: "Chief Marketing Officer",
  description:
    "Top-level orchestrator. Owns strategy, delegates to specialist agents, answers anything about your marketing.",
  delegates: ["content", "analyst", "prospector", "ads"],
  capabilities: [
    "prospect-memory",
    "trend-memory",
    "content-calendar",
    "campaign-memory",
    "schedule-manager",
  ],
} satisfies AgentManifest;
