import { z } from "zod";

import type { WorkspaceSnapshot } from "@chief/relay-contracts";
import { agentSummarySchema } from "@chief/relay-contracts";

import { externalAgentRuntimesFindExternalAgentSnapshotRows } from "./queries/external-agent-runtimes/find-external-agent-snapshot-rows";

const registrationResultJsonSchema = z.json();
type RegistrationResultJson = z.infer<typeof registrationResultJsonSchema>;

export interface ExternalAgentSnapshotRow extends Record<
  string,
  SqlStorageValue
> {
  agent_id: string;
  endpoint_url: string;
  connection_status: string;
  registration_result_json: string | null;
  replaces_native: number;
}

export function externalAgentSnapshotRows(storage: DurableObjectStorage) {
  return externalAgentRuntimesFindExternalAgentSnapshotRows<ExternalAgentSnapshotRow>(
    storage,
  );
}

export function reconcileExternalAgentSnapshot(
  snapshot: WorkspaceSnapshot,
  rows: readonly ExternalAgentSnapshotRow[],
) {
  if (rows.length === 0) return { snapshot, changed: false };
  const externalAgents = new Map(
    rows.flatMap((row) => {
      if (row.replaces_native === 1 && row.connection_status !== "connected") {
        return [];
      }
      const parsedJson = parseRegistrationResult(row.registration_result_json);
      const stored = z
        .object({ agent: agentSummarySchema })
        .safeParse(parsedJson);
      if (!stored.success) return [];
      const runtime = stored.data.agent.runtime;
      if (runtime.kind !== "external-channel") return [];
      const endpoint = z.url().safeParse(row.endpoint_url);
      const connectionStatus = z
        .enum(["pending_setup", "connected", "degraded"])
        .safeParse(row.connection_status);
      if (!endpoint.success || !connectionStatus.success) return [];
      return [
        [
          row.agent_id,
          {
            ...stored.data.agent,
            runtime: {
              ...runtime,
              endpoint: endpoint.data,
              connectionStatus: connectionStatus.data,
            },
          },
        ] as const,
      ];
    }),
  );
  const seen = new Set<string>();
  const agents = snapshot.agents.map((agent) => {
    const external = externalAgents.get(agent.id);
    if (!external) return agent;
    seen.add(agent.id);
    return { ...agent, runtime: external.runtime };
  });
  for (const [agentId, agent] of externalAgents) {
    if (!seen.has(agentId)) agents.push(agent);
  }
  const next = { ...snapshot, agents };
  return {
    snapshot: next,
    changed: JSON.stringify(next.agents) !== JSON.stringify(snapshot.agents),
  };
}

function parseRegistrationResult(
  value: string | null,
): RegistrationResultJson | undefined {
  if (!value) return undefined;
  try {
    const parsed = registrationResultJsonSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
