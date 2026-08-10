import type { ActionItem, AgentPreference } from "@chief/agent-runtime/types";

export function isDeploymentRecoveryAction(action: ActionItem | undefined) {
  return Boolean(
    action &&
    (action.id.includes("chief-deployment-required") ||
      action.reason.includes("DEPLOYMENT_NOT_FOUND") ||
      action.reason.includes("cloud deployment is no longer available")),
  );
}

export function localChiefPreference(
  existing: AgentPreference | undefined,
): AgentPreference {
  return {
    ...existing,
    agentId: "cmo",
    enabled: true,
    driver: "codex",
    model: undefined,
  };
}
