import type { ChildProcess } from "node:child_process";

import type { AgentDeploymentPhase, AgentDeploymentTarget } from "../types.js";

export interface DeploymentProviderInput {
  workspaceId: string;
  projectName: string;
  scope?: string;
  workspaceRoot: string;
  runtimeModules: string;
  routePassword: string;
  model: string;
  environment: Record<string, string>;
  channelEnvironmentKeys?: string[];
}

export interface DeploymentProviderResult {
  target: AgentDeploymentTarget;
  url: string;
  projectId?: string;
  scope?: string;
}

export interface DeploymentReporter {
  phase(phase: AgentDeploymentPhase, detail: string): void;
  log(line: string): void;
  process(child: ChildProcess | undefined): void;
  canceled(): boolean;
}

export interface AgentDeploymentProvider {
  readonly target: AgentDeploymentTarget;
  deploy(
    input: DeploymentProviderInput,
    reporter: DeploymentReporter,
  ): Promise<DeploymentProviderResult>;
}

export class DeploymentNeedsConfigurationError extends Error {
  readonly status = "needs_configuration" as const;
}
