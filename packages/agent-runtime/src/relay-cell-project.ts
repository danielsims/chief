import type { RelayClient } from "@chief/relay-client";
import type { AgentConfig, AgentJob } from "@chief/relay-contracts";
import { parseJsonString } from "@chief/relay-contracts";

import {
  listLocalProjectBindings,
  prepareLocalProjectCheckout,
} from "./projects/local-projects.js";

export async function localJobProject(
  client: RelayClient,
  job: AgentJob,
  agentId: string,
  config: AgentConfig,
) {
  if (!config.toolPermissions.includes("projects.read")) return null;
  const missionId = parseJsonString(job.payload.missionId);
  const mission = missionId
    ? (await client.listMissions()).find((item) => item.id === missionId)
    : undefined;
  if (missionId && !mission)
    throw new Error("The assigned mission is no longer accessible.");
  if (
    mission &&
    (mission.status !== "active" ||
      Date.parse(mission.deadline) <= Date.now() ||
      mission.experiments.length >= mission.maxExperiments)
  ) {
    throw new Error(
      "This mission has stopped. Resume or create a new bounded mission before assigning more work.",
    );
  }
  const explicitProjectId =
    parseJsonString(job.payload.projectId) ?? mission?.projectId;
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
    throw new Error(
      "Connect the mission's repository on this Mac in Projects before assigning local engineering work.",
    );
  if (!selected || !config.toolPermissions.includes("projects.write"))
    return null;
  return prepareLocalProjectCheckout({
    workspaceId: job.workspaceId,
    projectId: selected.projectId,
    agentId,
  });
}
