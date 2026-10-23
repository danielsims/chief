import type { RelayClient } from "@chief/relay-client";
import type { AgentConfig, AgentJob } from "@chief/relay-contracts";
import { parseJsonString } from "@chief/relay-contracts";

import {
  listLocalProjectBindings,
  prepareLocalProjectCheckout,
} from "./projects/local-projects.js";

export class LocalJobBlockedError extends Error {}

export async function localJobProject(
  client: RelayClient,
  job: AgentJob,
  agentId: string,
  config: AgentConfig,
) {
  if (!config.toolPermissions.includes("projects.read")) return null;
  const explicitProjectId = parseJsonString(job.payload.projectId);
  const [projects, bindings] = await Promise.all([
    client.listProjects(),
    listLocalProjectBindings(job.workspaceId),
  ]);
  const connected = bindings.filter((entry) =>
    projects.some((project) => project.id === entry.projectId),
  );
  const selected = explicitProjectId
    ? connected.find((entry) => entry.projectId === explicitProjectId)
    : connected.length === 1
      ? connected[0]
      : undefined;
  if (explicitProjectId && !selected)
    throw new LocalJobBlockedError(
      "Connect this project's repository on this Mac in Projects before assigning local engineering work.",
    );
  if (!selected || !config.toolPermissions.includes("projects.write"))
    return null;
  return prepareLocalProjectCheckout({
    workspaceId: job.workspaceId,
    projectId: selected.projectId,
    agentId,
  });
}
