import type { Principal } from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { HttpError } from "./http";
import { requireNativeAgent, workspaceAgent } from "./workspace-agent-runtime";

/** Messaging access is enforced by the relay, including existing DMs. */
export function canMessageAgent(
  store: WorkspaceChannelStore,
  agentId: string,
  principal: Principal,
): boolean {
  let agent;
  try {
    agent = workspaceAgent(store.storage, agentId);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    agent = requireNativeAgent(store.storage, agentId);
  }
  if (agent.runtime.kind !== "native-cell") return true;
  const config = store.agentConfiguration(agentId);
  if (
    config.deploymentTarget === "cloud" ||
    config.messageAccess === "workspace"
  )
    return true;
  const workspace = store.requireWorkspace(principal.workspaceId ?? "");
  const owner = agent.ownerUserId ?? String(workspace.created_by_user_id);
  if (principal.kind === "user") return principal.userId === owner;
  if (principal.kind === "service") return principal.service === "relay";
  if (principal.kind === "guest") return false;
  return principal.agentId === agentId;
}

/** Whether the agent runs on its owner's own computer or phone. */
export function deviceHostedAgent(
  store: WorkspaceChannelStore,
  agentId: string,
  workspaceId: string,
) {
  let agent;
  try {
    agent = workspaceAgent(store.storage, agentId);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    agent = requireNativeAgent(store.storage, agentId);
  }
  if (agent.runtime.kind !== "native-cell") return null;
  const target = store.agentConfiguration(agentId).deploymentTarget;
  if (target === "cloud") return null;
  return {
    ownerUserId:
      agent.ownerUserId ??
      String(store.requireWorkspace(workspaceId).created_by_user_id),
    device: target === "phone" ? ("phone" as const) : ("computer" as const),
  };
}

export function requireAgentMessageAccess(
  store: WorkspaceChannelStore,
  agentId: string,
  principal: Principal,
) {
  if (!canMessageAgent(store, agentId, principal)) {
    throw new HttpError(
      403,
      "agent_messaging_private",
      "This personal agent only responds to its owner. Its owner can enable workspace sharing in agent settings.",
    );
  }
}

export function requirePersonalAgentOwner(
  store: WorkspaceChannelStore,
  agentId: string,
  principal: Principal,
) {
  const agent = requireNativeAgent(store.storage, agentId);
  const owner =
    agent.ownerUserId ??
    String(
      store.requireWorkspace(principal.workspaceId ?? "").created_by_user_id,
    );
  if (principal.kind !== "user" || principal.userId !== owner) {
    throw new HttpError(
      403,
      "personal_agent_owner_required",
      "Only this personal agent's owner can change its settings.",
    );
  }
}
