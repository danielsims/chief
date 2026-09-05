import type { AgentDefinition } from "./types.js";
import { getAgent } from "./agents.js";

export interface WorkspaceAgentIdentity {
  id: string;
  name: string;
  role: string;
  description: string;
  instructions: string;
}

export function cellAgentDefinition(
  agentId: string,
  workspaceAgent?: WorkspaceAgentIdentity,
): AgentDefinition {
  const authored = getAgent(agentId);
  if (authored) {
    if (!workspaceAgent) return authored;
    return {
      ...authored,
      name: workspaceAgent.name,
      role: workspaceAgent.role,
      description: workspaceAgent.description || authored.description,
      instructions: workspaceAgent.instructions.trim() || authored.instructions,
    };
  }
  if (!workspaceAgent) {
    throw new Error(`Unknown agent ${agentId}.`);
  }
  return {
    id: workspaceAgent.id,
    name: workspaceAgent.name,
    role: workspaceAgent.role,
    description: workspaceAgent.description,
    instructions:
      workspaceAgent.instructions.trim() ||
      `# Identity\n\nYou are ${workspaceAgent.name}, the workspace's ${workspaceAgent.role}. Work through Chief for messaging, channels, workspace context, and approved tools.`,
  };
}
