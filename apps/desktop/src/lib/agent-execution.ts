import type { AgentPreference, DriverType } from "@chief/agent-runtime/types";
import type { WorkspaceAgentRuntime } from "@chief/relay-contracts";

export type RelayDeploymentTarget = NonNullable<
  AgentPreference["deploymentTarget"]
>;

export type AgentDeployment =
  | { kind: "chief-cloud" }
  | {
      kind: "on-device";
      relayTarget: Exclude<RelayDeploymentTarget, "cloud">;
    }
  | {
      kind: "vercel-eve";
      connectionStatus: "pending_setup" | "connected" | "degraded";
    };

export type NativeDeployment = Exclude<AgentDeployment, { kind: "vercel-eve" }>;

export interface AgentExecution {
  deployment: AgentDeployment;
  inference:
    | { kind: "unconfigured" }
    | { kind: "configured"; provider: DriverType; model: string }
    | { kind: "managed-by-deployment" };
}

export interface NativeExecutionDraft {
  deployment: NativeDeployment;
  provider: DriverType;
  model: string;
}

export function agentExecution({
  runtime,
  deploymentTarget,
  provider,
  model,
}: {
  runtime?: WorkspaceAgentRuntime;
  deploymentTarget: RelayDeploymentTarget;
  provider: DriverType | null;
  model: string;
}): AgentExecution {
  if (runtime?.kind === "external-channel") {
    return {
      deployment: {
        kind: "vercel-eve",
        connectionStatus: runtime.connectionStatus,
      },
      inference: { kind: "managed-by-deployment" },
    };
  }

  return {
    deployment: nativeDeployment(deploymentTarget),
    inference: provider
      ? { kind: "configured", provider, model }
      : { kind: "unconfigured" },
  };
}

export function nativeDeployment(
  target: RelayDeploymentTarget,
): NativeDeployment {
  return target === "cloud"
    ? { kind: "chief-cloud" }
    : { kind: "on-device", relayTarget: target };
}

export function relayDeploymentTarget(
  deployment: NativeDeployment,
): RelayDeploymentTarget {
  return deployment.kind === "chief-cloud" ? "cloud" : deployment.relayTarget;
}

export function selectDeployment({
  kind,
  current,
}: {
  kind: NativeDeployment["kind"];
  current: NativeDeployment;
}): NativeDeployment {
  if (kind === "chief-cloud") return { kind };
  return current.kind === "on-device"
    ? current
    : { kind, relayTarget: "desktop" };
}
