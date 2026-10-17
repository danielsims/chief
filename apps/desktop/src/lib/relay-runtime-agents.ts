import type {
  AgentDefinition,
  AgentPreference,
  ServerMessage,
} from "@chief/agent-runtime/types";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import { defaultAgents } from "@chief/agent-runtime/agent-roster";

import type { RelayRuntimeRelay } from "./relay-runtime-relay";
import { ensureDesktopCells } from "./desktop-cell-runtime";
import {
  relayAgentConfig,
  relayAgentPreference,
} from "./relay-agent-preferences";

export function relayAgentDefinitions(
  snapshot: WorkspaceSnapshot,
): AgentDefinition[] {
  const defaults = new Map(defaultAgents.map((agent) => [agent.id, agent]));
  return snapshot.agents.map((agent) => {
    const definition = defaults.get(agent.id);
    return {
      ...definition,
      id: agent.id,
      canMessage: agent.canMessage,
      avatar: agent.avatar,
      provider: agent.provider,
      name: agent.name,
      role: agent.role,
      description:
        nonEmpty(agent.description) ??
        definition?.description ??
        (agent.role !== "External agent"
          ? `${agent.name} handles ${agent.role.toLocaleLowerCase()} for this workspace.`
          : `${agent.name} is an external agent connected to this workspace.`),
      instructions:
        nonEmpty(agent.instructions) ?? definition?.instructions ?? "",
      delegates: agent.subagents.map((subagent) => subagent.id),
      subagents: agent.subagents.map((subagent) => {
        const authored = defaults.get(subagent.id);
        return {
          ...authored,
          ...subagent,
          description:
            nonEmpty(subagent.description) ?? authored?.description ?? "",
          instructions:
            nonEmpty(subagent.instructions) ?? authored?.instructions ?? "",
          capabilities: subagent.capabilities.filter(isAgentCapabilityId),
        };
      }),
      runtime: agent.runtime,
    };
  });
}

function nonEmpty(value: string) {
  return value.length > 0 ? value : undefined;
}

function isAgentCapabilityId(
  value: string,
): value is NonNullable<AgentDefinition["capabilities"]>[number] {
  return [
    "analytics-chart",
    "prospect-memory",
    "trend-memory",
    "content-calendar",
    "campaign-memory",
    "schedule-manager",
  ].includes(value);
}

export async function relayAgentPreferencesMessage(
  relay: RelayRuntimeRelay,
  snapshot: WorkspaceSnapshot,
  requestId?: string,
): Promise<Extract<ServerMessage, { type: "agentPreferences" }>> {
  let preferences: AgentPreference[] = [];
  try {
    preferences = (await relay.loadAgentConfigs()).map(relayAgentPreference);
  } catch (error) {
    console.error("[Chief relay] Could not load agent configuration.", error);
  }
  return {
    type: "agentPreferences",
    workspaceId: snapshot.id,
    ...(requestId ? { requestId } : undefined),
    preferences,
  };
}

export async function saveRelayAgentPreference(
  relay: RelayRuntimeRelay,
  snapshot: WorkspaceSnapshot,
  preference: AgentPreference,
) {
  const agent = snapshot.agents.find(
    (candidate) =>
      candidate.id === preference.agentId ||
      candidate.subagents.some((child) => child.id === preference.agentId),
  );
  if (agent?.runtime.kind !== "native-cell") {
    throw new Error(
      "External agents are configured through their channel runtime.",
    );
  }
  const current = await relay.loadAgentConfig(preference.agentId);
  await relay.saveAgentConfig(
    preference.agentId,
    relayAgentConfig(current.config, preference),
  );
  await ensureDesktopCells(snapshot, relay);
}
