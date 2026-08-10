import type {
  BuzzAgentSnapshot,
  BuzzTeamSnapshot,
  ChiefAgentCatalogEntry,
  ChiefBuzzAppManifest,
  ChiefChannelDefinition,
  ChiefToolProfile,
} from "./types.js";
import { chiefAgentAvatarDataUrl } from "./brand.js";
import { chiefSystemPrompt } from "./chief-prompt.js";
import { setupSystemPrompt } from "./setup-prompt.js";
import {
  analystSystemPrompt,
  contentSystemPrompt,
  engineeringSystemPrompt,
  prospectorSystemPrompt,
} from "./specialist-prompts.js";

export const sharedHostCapabilities = [
  "buzz.conversation",
  "buzz.artifacts",
  "buzz.pulse",
] as const;

export const chiefToolProfiles = [
  {
    id: "chief",
    executorToolkit: "chief",
    hostCapabilities: [
      "buzz.channels",
      "buzz.teams",
      "buzz.canvas",
      "buzz.workflows",
      "buzz.pulse",
    ],
    description:
      "Coordinates onboarding, the workspace, scheduled work, weekly reviews, and approved business tools.",
  },
  {
    id: "chief-setup",
    executorToolkit: "chief-setup",
    hostCapabilities: [],
    description:
      "Connects services through the pinned agent-browser CLI while keeping credentials out of chat.",
  },
  {
    id: "chief-analyst",
    executorToolkit: "chief-analyst",
    hostCapabilities: ["buzz.workflows", "buzz.pulse", "chief.reports"],
    description: "Reads approved analytics and reporting sources.",
  },
  {
    id: "chief-content",
    executorToolkit: "chief-content",
    hostCapabilities: ["buzz.pulse"],
    description: "Creates content with approved publishing tools.",
  },
  {
    id: "chief-prospector",
    executorToolkit: "chief-prospector",
    hostCapabilities: ["buzz.pulse"],
    description: "Finds qualified prospects and timely market conversations.",
  },
  {
    id: "chief-engineering",
    executorToolkit: "chief-engineering",
    hostCapabilities: ["buzz.pulse"],
    description: "Makes approved repository and deployment changes.",
  },
] as const satisfies readonly ChiefToolProfile[];

export const chiefAgentCatalog = [
  {
    id: "chief",
    displayName: "Chief",
    description:
      "Leads the team, configures its workspace, and owns the user-facing result.",
    release: "included",
    toolProfile: "chief",
  },
  {
    id: "setup",
    displayName: "Setup",
    description:
      "Connects services through a visible browser and prepares the workspace.",
    release: "included",
    toolProfile: "chief-setup",
  },
  {
    id: "analyst",
    displayName: "Analyst",
    description: "Turns marketing and business data into decisions.",
    release: "included",
    toolProfile: "chief-analyst",
  },
  {
    id: "content",
    displayName: "Content Writer",
    description: "Plans, drafts, and improves marketing content.",
    release: "included",
    toolProfile: "chief-content",
  },
  {
    id: "prospector",
    displayName: "Prospector",
    description: "Finds qualified prospects and timely market conversations.",
    release: "included",
    toolProfile: "chief-prospector",
  },
  {
    id: "engineering",
    displayName: "Engineering",
    description: "Implements approved technical growth changes.",
    release: "included",
    toolProfile: "chief-engineering",
  },
] as const satisfies readonly ChiefAgentCatalogEntry[];

function agentSnapshot({
  name,
  prompt,
  about,
}: {
  name: string;
  prompt: string;
  about: string;
}): BuzzAgentSnapshot {
  return {
    format: "buzz-agent-snapshot",
    version: 1,
    definition: {
      name,
      systemPrompt: prompt,
      runtime: "codex",
      parallelism: 1,
      respondTo: "owner-only",
      idleTimeoutSeconds: 900,
      maxTurnDurationSeconds: 1800,
    },
    profile: {
      displayName: name,
      about,
      avatarDataUrl: chiefAgentAvatarDataUrl,
    },
    memory: {
      level: "none",
    },
  };
}

export const chiefAgentSnapshot = agentSnapshot({
  name: "Chief",
  prompt: chiefSystemPrompt,
  about:
    "Leads the Chief team, coordinates work, and keeps the workspace aligned.",
});

export const setupAgentSnapshot = agentSnapshot({
  name: "Setup",
  prompt: setupSystemPrompt,
  about: "Connects services for Chief through a visible, interactive browser.",
});

export const analystAgentSnapshot = agentSnapshot({
  name: "Analyst",
  prompt: analystSystemPrompt,
  about: "Turns connected marketing and business data into decisions.",
});

export const contentAgentSnapshot = agentSnapshot({
  name: "Content Writer",
  prompt: contentSystemPrompt,
  about: "Creates platform-native marketing content in the brand's voice.",
});

export const prospectorAgentSnapshot = agentSnapshot({
  name: "Prospector",
  prompt: prospectorSystemPrompt,
  about: "Finds qualified prospects and timely conversations worth joining.",
});

export const engineeringAgentSnapshot = agentSnapshot({
  name: "Engineering",
  prompt: engineeringSystemPrompt,
  about: "Implements focused, reviewable technical growth changes.",
});

export const chiefChannels = [
  {
    id: "chief-hq",
    purpose:
      "Chief's town hall for weekly all-hands reviews, decisions, and cross-team coordination.",
    visibility: "open",
    channelType: "stream",
    includeInstaller: true,
    members: [
      "chief",
      "setup",
      "analyst",
      "content",
      "prospector",
      "engineering",
    ],
  },
  {
    id: "chief-marketing",
    purpose: "Marketing strategy, analytics, and content execution.",
    visibility: "open",
    channelType: "stream",
    includeInstaller: true,
    members: ["chief", "analyst", "content"],
  },
  {
    id: "chief-prospecting",
    purpose: "Qualified prospects and timely market conversations.",
    visibility: "open",
    channelType: "stream",
    includeInstaller: true,
    members: ["chief", "prospector"],
  },
  {
    id: "chief-engineering",
    purpose: "Reviewable technical changes tied to marketing outcomes.",
    visibility: "open",
    channelType: "stream",
    includeInstaller: true,
    members: ["chief", "engineering"],
  },
  {
    id: "chief-setup",
    purpose:
      "Private onboarding, integration setup, authentication handoffs, and verification.",
    visibility: "private",
    channelType: "stream",
    includeInstaller: true,
    members: ["chief", "setup"],
  },
] as const satisfies readonly ChiefChannelDefinition[];

export const chiefMarketingTeamSnapshot = {
  format: "buzz-team-snapshot",
  version: 1,
  team: {
    name: "Chief",
    description:
      "A Chief-owned marketing team that works together inside Buzz.",
    instructions:
      "Chief is the primary orchestrator. Add this team to an existing chief-hq channel, then mention Chief once to start setup. Chief must include the installing human, continue the private questionnaire in a one-to-one DM where replies need no repeated mention, use chief-setup for integration work, wake specialists with exact mentioned assignments, create approved recurring workflows, and use Pulse for safe executive updates.",
  },
  members: [
    chiefAgentSnapshot,
    setupAgentSnapshot,
    analystAgentSnapshot,
    contentAgentSnapshot,
    prospectorAgentSnapshot,
    engineeringAgentSnapshot,
  ],
} as const satisfies BuzzTeamSnapshot;

export const chiefBuzzAppManifest = {
  format: "chief-buzz-app",
  version: 1,
  app: {
    id: "sh.heychief.marketing",
    name: "Chief",
    description: "A complete Chief marketing team for a Buzz workspace.",
    publisher: {
      id: "sh.heychief",
      name: "Chief",
      website: "https://heychief.sh",
    },
  },
  release: {
    teamSnapshot: "./chief.team.json",
    includedAgents: [
      "chief",
      "setup",
      "analyst",
      "content",
      "prospector",
      "engineering",
    ],
  },
  workspace: {
    channels: chiefChannels,
  },
  sharedHostCapabilities,
  toolProfiles: chiefToolProfiles,
  agents: chiefAgentCatalog,
} as const satisfies ChiefBuzzAppManifest;
