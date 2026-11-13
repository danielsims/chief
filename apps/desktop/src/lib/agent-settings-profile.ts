import type {
  AgentDefinition,
  AgentPreference,
} from "@chief/agent-runtime/types";

export type AgentLocationFilter = "all" | "local" | "cloud";

/** Children have their own preferences and access; Eve children share a deployment. */
export function agentSettingsProfile(
  root: AgentDefinition,
  profileId: string,
): AgentDefinition {
  const child = root.subagents?.find((profile) => profile.id === profileId);
  return child ? { ...child, runtime: root.runtime } : root;
}

export function agentListEntries(
  agents: readonly AgentDefinition[],
  preferences: readonly AgentPreference[],
) {
  return agents.flatMap((root) => {
    const rootPreference = preferences.find(
      (entry) => entry.agentId === root.id,
    );
    return [root, ...(root.subagents ?? [])].map((profile) => {
      const agent = agentSettingsProfile(root, profile.id);
      const preference = preferences.find(
        (entry) => entry.agentId === agent.id,
      );
      const inherited = profile.id === root.id ? undefined : rootPreference;
      const target =
        preference?.deploymentTarget ??
        inherited?.deploymentTarget ??
        ((preference?.driver ?? inherited?.driver) === "remote"
          ? "cloud"
          : "desktop");
      const location: Exclude<AgentLocationFilter, "all"> =
        agent.runtime?.kind === "external-channel" || target === "cloud"
          ? "cloud"
          : "local";
      return { rootId: root.id, agent, preference, location };
    });
  });
}
