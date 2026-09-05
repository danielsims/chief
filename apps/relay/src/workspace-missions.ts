import type { Mission } from "@chief/relay-contracts";
import {
  missionBestValue,
  missionCreateSchema,
  missionExperimentInputSchema,
  missionSchema,
  missionStatusUpdateSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { WorkspaceChannelStore } from "./workspace-channel-store";

export function readWorkspaceMission(
  storage: DurableObjectStorage,
  id: string,
) {
  const row = storage.sql
    .exec<{ document_json: string }>(
      "SELECT document_json FROM missions WHERE mission_id = ?",
      id,
    )
    .toArray()[0];
  return row ? missionSchema.parse(JSON.parse(row.document_json)) : null;
}

function saveMission(storage: DurableObjectStorage, mission: Mission) {
  storage.sql.exec(
    "INSERT INTO missions (mission_id, document_json) VALUES (?, ?) ON CONFLICT(mission_id) DO UPDATE SET document_json = excluded.document_json",
    mission.id,
    JSON.stringify(mission),
  );
  return json(mission);
}

export async function routeWorkspaceMissions(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
  operation: string,
) {
  const context = readTrustedContext(request);
  const store = new WorkspaceChannelStore(storage, env);
  store.requireWorkspace(context.workspaceId);
  store.requirePrincipalMember(context.principal);
  store.requireAgentCapability(
    context.principal,
    operation === "missions-list" ? "workspace.read" : "workspace.write",
  );
  if (operation === "missions-list") {
    const missions = storage.sql
      .exec<{ document_json: string }>(
        "SELECT document_json FROM missions ORDER BY rowid DESC",
      )
      .toArray()
      .map((row) => missionSchema.parse(JSON.parse(row.document_json)))
      .filter((mission) =>
        store
          .channelMemberRows(mission.conversationId)
          .some(
            (member) =>
              member.kind === context.principal.kind &&
              member.principalId ===
                (context.principal.kind === "user"
                  ? context.principal.userId
                  : context.principal.agentId),
          ),
      );
    return json({ missions });
  }
  const body = await parseJson(request);
  const now = new Date().toISOString();
  if (operation === "missions-create") {
    const input = missionCreateSchema.parse(body);
    store.requireChannelVisible(input.conversationId, context.principal);
    const members = store.channelMemberRows(input.conversationId);
    for (const agentId of [input.ownerAgentId, ...input.collaborators]) {
      if (
        !members.some(
          (member) => member.kind === "agent" && member.principalId === agentId,
        )
      ) {
        throw new HttpError(
          409,
          "mission_members_missing",
          "Add the mission owner and collaborators to its channel first.",
        );
      }
    }
    if (Date.parse(input.deadline) <= Date.now())
      throw new HttpError(400, "mission_deadline", "Choose a future deadline.");
    const existing = readWorkspaceMission(storage, input.id);
    if (existing) {
      store.requireChannelVisible(existing.conversationId, context.principal);
      if (existing.conversationId !== input.conversationId)
        throw new HttpError(
          409,
          "mission_id_used",
          "This mission id belongs to another channel.",
        );
      return json(existing);
    }
    if (
      input.success.kind === "metric" &&
      (input.success.direction === "increase"
        ? input.success.target <= input.success.baseline
        : input.success.target >= input.success.baseline)
    ) {
      throw new HttpError(
        400,
        "mission_target",
        "The target must improve on the measured baseline.",
      );
    }
    return saveMission(storage, {
      ...input,
      workspaceId: context.workspaceId,
      status: "active",
      statusEvidence: null,
      experiments: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  const id = request.headers.get("x-chief-mission-id") ?? "";
  const mission = readWorkspaceMission(storage, id);
  if (!mission)
    throw new HttpError(404, "mission_missing", "Mission not found.");
  store.requireChannelVisible(mission.conversationId, context.principal);
  if (
    context.principal.kind === "agent" &&
    context.principal.agentId !== mission.ownerAgentId &&
    !mission.collaborators.includes(context.principal.agentId)
  ) {
    throw new HttpError(
      403,
      "mission_owner",
      "Only the mission team can record its work.",
    );
  }
  if (operation === "missions-status") {
    const input = missionStatusUpdateSchema.parse(body);
    if (
      input.status === "active" &&
      (Date.parse(mission.deadline) <= Date.now() ||
        mission.experiments.length >= mission.maxExperiments)
    ) {
      throw new HttpError(
        409,
        "mission_limit",
        "This mission has reached its deadline or experiment limit. Start a new bounded mission.",
      );
    }
    if (
      input.status === "completed" &&
      mission.success.kind === "metric" &&
      !targetReached(mission)
    ) {
      throw new HttpError(
        409,
        "mission_target_not_reached",
        "Record a measured improvement that reaches the target, or pause this mission.",
      );
    }
    return saveMission(storage, {
      ...mission,
      status: input.status,
      statusEvidence: input.evidence,
      updatedAt: now,
    });
  }
  const input = missionExperimentInputSchema.parse(body);
  if (mission.experiments.some((item) => item.id === input.id))
    return json(mission);
  if (
    mission.status !== "active" ||
    Date.parse(mission.deadline) <= Date.now() ||
    mission.experiments.length >= mission.maxExperiments
  ) {
    throw new HttpError(
      409,
      "mission_limit",
      "The mission is paused, completed, or has reached its limits.",
    );
  }
  const best = missionBestValue(mission);
  if (
    input.decision === "keep" &&
    mission.success.kind === "metric" &&
    (input.value === null ||
      best === null ||
      (mission.success.direction === "increase"
        ? input.value <= best
        : input.value >= best))
  ) {
    throw new HttpError(
      400,
      "mission_no_improvement",
      "A kept experiment needs a measured improvement over the best result.",
    );
  }
  const updated: Mission = {
    ...mission,
    updatedAt: now,
    experiments: [
      ...mission.experiments,
      {
        ...input,
        recordedAt: now,
        agentId:
          context.principal.kind === "agent" ? context.principal.agentId : null,
      },
    ],
  };
  updated.status = targetReached(updated)
    ? "completed"
    : updated.experiments.length >= updated.maxExperiments
      ? "paused"
      : "active";
  return saveMission(storage, updated);
}

function targetReached(mission: Mission) {
  const value = missionBestValue(mission);
  return (
    mission.success.kind === "metric" &&
    value !== null &&
    (mission.success.direction === "increase"
      ? value >= mission.success.target
      : value <= mission.success.target)
  );
}
