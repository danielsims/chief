import type { AgentSummary } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { firstRow } from "./workspace-channel-store";
import { decodeWorkspaceSnapshot } from "./workspace-defaults";

export function workspaceAgent(
  storage: DurableObjectStorage,
  agentId: string,
): AgentSummary {
  const row = firstRow<
    { snapshot_json: string | null } & Record<string, SqlStorageValue>
  >(
    storage.sql.exec("SELECT snapshot_json FROM workspace WHERE singleton = 1"),
  );
  const agent = row?.snapshot_json
    ? decodeWorkspaceSnapshot(row.snapshot_json).agents.find(
        (candidate) => candidate.id === agentId,
      )
    : undefined;
  if (!agent)
    throw new HttpError(
      404,
      "agent_not_found",
      "This agent is not part of the workspace.",
    );
  return agent;
}

export function requireNativeAgent(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const external = firstRow(
    storage.sql.exec(
      "SELECT agent_id FROM external_agent_runtimes WHERE agent_id = ?",
      agentId,
    ),
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
      status: "idle",
      runtime: { kind: "native-cell" },
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
