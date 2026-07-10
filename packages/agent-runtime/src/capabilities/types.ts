import type { AgentCapabilityId, AgentDefinition } from "../types.js";

export interface AgentCapability {
  id: AgentCapabilityId;
  toolName: string;
  partType: string;
  instructions: string;
}

type ComposableAgentDefinition = Omit<AgentDefinition, "capabilities"> & {
  capabilities?: readonly AgentCapability[];
};

/** Compose an agent from small capability modules while exposing only IDs. */
export function defineAgent(
  definition: ComposableAgentDefinition,
): AgentDefinition {
  const { capabilities = [], ...agent } = definition;
  return {
    ...agent,
    capabilities: capabilities.map((capability) => capability.id),
    instructions: [
      definition.instructions,
      ...capabilities.map((capability) => capability.instructions),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
