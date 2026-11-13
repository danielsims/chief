import type {
  AgentDefinition,
  AgentPreference,
  DriverType,
} from "@chief/agent-runtime/types";

/** The same execution for an agent and its own subagents, never other agents. */
export function executionPreferencesForTeam(
  root: AgentDefinition,
  preferences: readonly AgentPreference[],
  deploymentTarget: "phone" | "desktop" | "cloud",
  driver: DriverType,
  model?: string,
) {
  // Subagents are packaged in their root's deployment, so they run with it.
  if (root.runtime?.kind === "external-channel") return [];
  return [root, ...(root.subagents ?? [])].map((agent): AgentPreference => {
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
