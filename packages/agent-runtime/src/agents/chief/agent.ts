import type { AgentManifest } from "../manifest.js";

export const chief = {
  id: "chief",
  name: "Chief",
  role: "Workspace Lead",
  description:
    "Leads the workspace, turns priorities into focused work, and coordinates the right agents through review.",
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
