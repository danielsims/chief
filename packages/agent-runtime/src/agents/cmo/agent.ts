import type { AgentManifest } from "../manifest.js";

export const cmo = {
  id: "cmo",
  name: "Chief",
  role: "Chief Marketing Officer",
  description:
    "Top-level orchestrator. Owns strategy, delegates to specialist agents, answers anything about your marketing.",
  delegates: [
    "brand",
    "content",
    "analyst",
    "prospector",
    "ads",
    "engineer",
    "setup",
  ],
  capabilities: [
    "prospect-memory",
    "trend-memory",
    "content-calendar",
    "campaign-memory",
    "schedule-manager",
  ],
} satisfies AgentManifest;
