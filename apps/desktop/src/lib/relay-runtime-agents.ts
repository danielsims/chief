import type {
  AgentDefinition,
  ClientMessage,
  ServerMessage,
} from "@chief/agent-runtime/types";
import type { WorkspaceSnapshot } from "@chief/relay-contracts";

import type { RelayRuntimeRelay } from "./relay-runtime-relay";
import { ensureDesktopCells } from "./desktop-cell-runtime";
import {
  relayAgentConfig,
  relayAgentPreference,
} from "./relay-agent-preferences";

export function relayAgentDefinitions(
  snapshot: WorkspaceSnapshot,
): AgentDefinition[] {
  return snapshot.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    description:
      "Runs in its own isolated cell and collaborates through the Chief relay.",
    instructions: "",
  }));
}

export async function relayAgentPreferencesMessage(
  relay: RelayRuntimeRelay,
  snapshot: WorkspaceSnapshot,
  requestId?: string,
): Promise<Extract<ServerMessage, { type: "agentPreferences" }>> {
  const preferences = await Promise.all(
    snapshot.agents.map(async (agent) =>
      relayAgentPreference(await relay.loadAgentConfig(agent.id)),
    ),
  );
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
  message: Extract<ClientMessage, { type: "saveAgentPreference" }>,
) {
  const current = await relay.loadAgentConfig(message.preference.agentId);
  await relay.saveAgentConfig(
    message.preference.agentId,
    relayAgentConfig(current.config, message.preference),
  );
  await ensureDesktopCells(snapshot, relay);
}
