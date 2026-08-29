import type {
  AgentDefinition,
  AgentPreference,
  DriverType,
} from "@chief/agent-runtime/types";

export function executionPreferencesForTeam(
  agents: readonly AgentDefinition[],
  preferences: readonly AgentPreference[],
  deploymentTarget: "phone" | "desktop" | "cloud",
  driver: DriverType,
  model?: string,
) {
  return agents.map((agent): AgentPreference => {
    const current = preferences.find((item) => item.agentId === agent.id);
    return {
      ...current,
      agentId: agent.id,
      enabled: current?.enabled ?? true,
      deploymentTarget,
      driver,
      model,
    };
  });
}
