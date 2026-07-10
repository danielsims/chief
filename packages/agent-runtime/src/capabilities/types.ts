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
    baseInstructions: definition.instructions,
    capabilities: capabilities.map((capability) => capability.id),
    instructions: [
      definition.instructions,
      ...capabilities.map((capability) => capability.instructions),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function composeAgentCapabilities(
  agent: AgentDefinition,
  capabilities: readonly AgentCapability[],
): AgentDefinition {
  const base = agent.baseInstructions ?? agent.instructions;
  return {
    ...agent,
    baseInstructions: base,
    capabilities: capabilities.map((capability) => capability.id),
    instructions: [
      base,
      ...capabilities.map((capability) => capability.instructions),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
