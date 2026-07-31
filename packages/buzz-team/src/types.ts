export type ChiefAgentId =
  "chief" | "setup" | "analyst" | "content" | "prospector" | "engineering";

export type ChiefToolProfileId =
  | "chief-setup"
  | "chief"
  | "chief-analyst"
  | "chief-content"
  | "chief-prospector"
  | "chief-engineering";

export type ChiefChannelId =
  | "chief-hq"
  | "chief-marketing"
  | "chief-prospecting"
  | "chief-engineering"
  | "chief-setup";

export interface ChiefChannelDefinition {
  id: ChiefChannelId;
  purpose: string;
  visibility: "open" | "private";
  channelType: "stream";
  includeInstaller: true;
  members: readonly ChiefAgentId[];
}

export interface ChiefToolProfile {
  id: ChiefToolProfileId;
  executorToolkit: ChiefToolProfileId;
  hostCapabilities: readonly string[];
  description: string;
}

export interface ChiefAgentCatalogEntry {
  id: ChiefAgentId;
  displayName: string;
  description: string;
  release: "included" | "planned";
  toolProfile: ChiefToolProfileId;
}

export interface ChiefBuzzAppManifest {
  format: "chief-buzz-app";
  version: 1;
  app: {
    id: "sh.heychief.marketing";
    name: string;
    description: string;
    publisher: {
      id: "sh.heychief";
      name: "Chief";
      website: "https://heychief.sh";
    };
  };
  release: {
    teamSnapshot: string;
    includedAgents: readonly ChiefAgentId[];
  };
  workspace: {
    channels: readonly ChiefChannelDefinition[];
  };
  sharedHostCapabilities: readonly string[];
  toolProfiles: readonly ChiefToolProfile[];
  agents: readonly ChiefAgentCatalogEntry[];
}

export interface BuzzAgentSnapshot {
  format: "buzz-agent-snapshot";
  version: 1;
  definition: {
    name: string;
    systemPrompt: string;
    runtime: "codex";
    parallelism: number;
    respondTo: "owner-only";
    idleTimeoutSeconds: number;
    maxTurnDurationSeconds: number;
  };
  profile: {
    displayName: string;
    about: string;
    avatarDataUrl: string;
  };
  memory: {
    level: "none";
  };
}

export interface BuzzTeamSnapshot {
  format: "buzz-team-snapshot";
  version: 1;
  team: {
    name: string;
    description: string;
    instructions: string;
  };
  members: readonly BuzzAgentSnapshot[];
}
