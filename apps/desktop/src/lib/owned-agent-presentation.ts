import type { AgentDefinition } from "@chief/agent-runtime/types";
import type { OwnedAgent } from "@chief/relay-contracts";

export function agentName(provider: string, name: string) {
  const key = name.trim().toLowerCase() || provider;
  if (key === "codex" || key === "chatgpt") return "ChatGPT";
  if (key === "claude") return "Claude";
  if (key === "grok") return "Grok";
  if (key === "opencode") return "OpenCode";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** What people call an owned agent: its chosen name, or its provider's. */
export function ownedAgentLabel(
  agent: Pick<OwnedAgent, "provider" | "name" | "displayName">,
) {
  return agent.displayName ?? agentName(agent.provider, agent.name);
}

/** A Chief-run agent's namespaced name, username:agent. It comes from the
 * agent's id, which the relay keeps unique, so agents sharing a name still
 * get distinct handles (opencode, opencode-2). */
export function workspaceAgentHandle(username: string | null, agentId: string) {
  return username ? `${username}:${agentId}` : null;
}

/** An owned agent shaped like the workspace's own, so it shares their UI. */
export function ownedAgentDefinition(agent: OwnedAgent): AgentDefinition {
  const label = ownedAgentLabel(agent);
  const owner = agent.owner.name ?? agent.owner.username ?? "its owner";
  const definition: AgentDefinition = {
    id: agent.id,
    name: label,
    role: "Connected agent",
    description: `${label} runs on ${owner}'s own host and reads and posts in the channels it has been added to.`,
    instructions: "",
  };
  if (agent.avatar) definition.avatar = agent.avatar;
  return definition;
}
