import type {
  AgentDefinition,
  AgentPreference,
  DriverType,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type {
  CreateNativeAgentCommand,
  OwnedAgentRequest,
} from "@chief/relay-contracts";

import { agentName } from "./owned-agent-presentation";

/** The on-device driver for agents this computer can run itself. */
export function onDeviceDriver(
  request: Pick<OwnedAgentRequest, "provider" | "name">,
): Exclude<DriverType, "remote"> | null {
  if (request.provider === "chatgpt" || request.provider === "codex")
    return "codex";
  if (request.provider === "claude") return "claude";
  if (request.provider === "other" && request.name === "opencode")
    return "opencode";
  return null;
}

/**
 * Accepts an agent's request under the name chosen on its card. Agents this
 * device can run join as on-device agents, so they wake and reply like any
 * other; the rest join from their own host.
 */
export async function acceptAgentRequest({
  client,
  request,
  name,
  agents,
  createNativeAgent,
}: {
  client: RelayClient;
  request: OwnedAgentRequest;
  name: string;
  agents: readonly AgentDefinition[];
  createNativeAgent: (
    input: CreateNativeAgentCommand,
    preference?: AgentPreference,
  ) => Promise<void>;
}) {
  const label = name.trim() || agentName(request.provider, request.name);
  const driver = onDeviceDriver(request);
  if (!driver) {
    const { agent } = await client.decideOwnedAgent(request.id, true);
    if (agent && label !== agentName(request.provider, request.name))
      await client.renameOwnedAgent(agent.id, label);
    return;
  }
  const agentId = availableAgentId(label, agents);
  const brand = agentName(request.provider, request.name);
  await createNativeAgent(
    {
      agentId,
      name: label,
      role: `${brand} on this device`,
      description: `Joined the workspace from ${brand}.`,
      instructions: `You are ${label}, a ${brand} agent taking part in this Chief workspace. Join in where you're brought into a conversation, and be helpful, friendly and concise.`,
      connectionKind: "owned",
    },
    { agentId, enabled: true, deploymentTarget: "desktop", driver },
  );
  await client.welcomeOwnedAgentOnDevice(request.id);
}

function availableAgentId(name: string, agents: readonly AgentDefinition[]) {
  const taken = new Set(
    agents.flatMap((agent) => [
      agent.id,
      ...(agent.subagents ?? []).map((child) => child.id),
    ]),
  );
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 56) || "agent";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}
