export interface EveAgentEnvironment {
  CHIEF_AGENT_ID: string;
  CHIEF_CHANNEL_TOKEN: string;
  CHIEF_DELIVERY_SIGNING_KEY_ID: string;
  CHIEF_DELIVERY_SIGNING_SECRET: string;
  CHIEF_RELAY_URL: string;
  CHIEF_WORKSPACE_ID: string;
}

export interface VercelTeamOption {
  id: string;
  name: string;
  slug: string;
}

export interface VercelProjectOption {
  id: string;
  name: string;
  framework?: string;
  productionDeploymentUrl?: string;
}

export interface VercelEveDestinationCatalog {
  teams: VercelTeamOption[];
  projects: VercelProjectOption[];
  selectedTeamId?: string;
}

export type VercelEveProjectDestination =
  | { kind: "existing"; projectId: string; projectName: string }
  | { kind: "new"; projectName: string };

export interface EveAgentProvisioningInput {
  teamId: string;
  project: VercelEveProjectDestination;
  agent: {
    id?: string;
    name: string;
    role?: string;
    description: string;
    instructions: string;
    capabilities?: string[];
    subagents?: EveAgentSubagent[];
    model: string;
  };
  environment: EveAgentEnvironment;
}

export interface EveAgentSubagent {
  id: string;
  name: string;
  role: string;
  description: string;
  instructions: string;
  capabilities?: string[];
}

export interface EveAgentProvisioningResult {
  projectId: string;
  deploymentId: string;
  deploymentUrl: string;
  inspectorUrl?: string;
}

export type EveAgentProvisioningPhase =
  | "validating"
  | "uploading"
  | "deploying"
  | "configuring"
  | "redeploying"
  | "waiting"
  | "checking";

export type VercelDeploymentReadyState =
  "QUEUED" | "INITIALIZING" | "BUILDING" | "READY" | "ERROR" | "CANCELED";

export interface EveDeploymentLogLine {
  source: "command" | "stdout" | "stderr" | "fatal" | "status";
  text: string;
  at?: number;
}

export interface EveAgentProvisioningProgress {
  phase: EveAgentProvisioningPhase;
  projectId?: string;
  deploymentId?: string;
  deploymentUrl?: string;
  inspectorUrl?: string;
  readyState?: VercelDeploymentReadyState;
  buildStartedAt?: number;
  logs?: EveDeploymentLogLine[];
}
