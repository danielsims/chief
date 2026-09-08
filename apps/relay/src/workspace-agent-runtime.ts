import type { AgentSummary } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { externalAgentRuntimesFindRequireNativeAgent } from "./queries/external-agent-runtimes/find-require-native-agent";
import { workspaceFindWorkspaceAgent } from "./queries/workspace/find-workspace-agent";
import { firstRow } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";

export function workspaceAgent(
  storage: DurableObjectStorage,
  agentId: string,
): AgentSummary {
  const row = firstRow<
    { snapshot_json: string | null } & Record<string, SqlStorageValue>
  >(workspaceFindWorkspaceAgent(storage));
  const snapshot = row?.snapshot_json
    ? decodeWorkspaceSnapshot(row.snapshot_json)
    : undefined;
  const rootAgent = snapshot?.agents.find(
    (candidate) => candidate.id === agentId,
  );
  if (rootAgent) return rootAgent;
  const parent = snapshot?.agents.find((agent) =>
    agent.subagents.some((child) => child.id === agentId),
  );
  const subagent = parent?.subagents.find(
    (candidate) => candidate.id === agentId,
  );
  if (!subagent)
    throw new HttpError(
      404,
      "agent_not_found",
      "This agent is not part of the workspace.",
    );
  return {
    ...subagent,
    ownerUserId: subagent.ownerUserId ?? parent?.ownerUserId,
    status: "idle",
    runtime: parent?.runtime ?? { kind: "native-cell" },
    subagents: [],
  };
}

export function requireNativeAgent(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const external = firstRow(
    externalAgentRuntimesFindRequireNativeAgent(storage, agentId),
  );
  if (external) {
    throw new HttpError(
      409,
      "external_agent_native_runtime_denied",
      "External agents are invoked through their channel protocol.",
    );
  }
  let agent: AgentSummary;
  try {
    agent = workspaceAgent(storage, agentId);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    agent = {
      id: agentId,
      name: agentId,
      role: "Agent",
      description: "",
      instructions: "",
      capabilities: [],
      status: "idle",
      runtime: { kind: "native-cell" },
      subagents: [],
    };
  }
  if (agent.runtime.kind !== "native-cell") {
    throw new HttpError(
      409,
      "external_agent_native_runtime_denied",
      "External agents are invoked through their channel protocol.",
    );
  }
  return agent;
}

/** Resolve only roster-declared children to their owning deployment. */
export function externalRuntimeOwner(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const row = firstRow<
    { snapshot_json: string | null } & Record<string, SqlStorageValue>
  >(workspaceFindWorkspaceAgent(storage));
  const snapshot = row?.snapshot_json
    ? decodeWorkspaceSnapshot(row.snapshot_json)
    : undefined;
  if (snapshot?.agents.some((agent) => agent.id === agentId)) return agentId;
  return (
    snapshot?.agents.find(
      (agent) =>
        agent.runtime.kind !== "native-cell" &&
        agent.subagents.some((child) => child.id === agentId),
    )?.id ?? agentId
  );
}
