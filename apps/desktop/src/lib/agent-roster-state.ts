import type { AgentDefinition } from "@chief/agent-runtime/types";

export function removeAgentFromRoster(
  agents: readonly AgentDefinition[],
  agentId: string,
): AgentDefinition[] {
  return agents.filter((agent) => agent.id !== agentId);
}
