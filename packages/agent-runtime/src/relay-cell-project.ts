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
  const missionId = parseJsonString(job.payload.missionId);
  const missions = config.toolPermissions.includes("workspace.read")
    ? await client.listMissions()
    : [];
  const channelMissions = missions.filter(
    (item) =>
      item.conversationId === job.payload.conversationId &&
      item.status === "active" &&
      (item.ownerAgentId === agentId ||
        item.collaborators.some((collaborator) => collaborator === agentId)),
  );
  const mission = missionId
    ? missions.find((item) => item.id === missionId)
    : channelMissions.length === 1
      ? channelMissions[0]
      : undefined;
  if (missionId && !mission)
    throw new LocalJobBlockedError(
      "The assigned mission is no longer accessible.",
    );
  if (
    mission &&
    (mission.status !== "active" ||
      Date.parse(mission.deadline) <= Date.now() ||
      mission.experiments.length >= mission.maxExperiments)
  ) {
    throw new LocalJobBlockedError(
      "This mission has stopped. Resume or create a new bounded mission before assigning more work.",
    );
  }
  if (!config.toolPermissions.includes("projects.read")) return null;
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
    throw new LocalJobBlockedError(
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
