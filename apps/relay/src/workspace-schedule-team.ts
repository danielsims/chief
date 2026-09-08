import type { Principal } from "@chief/relay-contracts";
import { scheduleRunCollaboratorSchema } from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { requireAgentMessageAccess } from "./workspace-agent-messaging";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { readWorkspaceMission } from "./workspace-missions";
import {
  readScheduleRun,
  scheduleRunIsActive,
  writeScheduleRun,
} from "./workspace-schedule-runs";
import { prepareScheduleChannel } from "./workspace-schedule-setup";
import { wakeWorkspaceSchedules } from "./workspace-schedule-store";

/** Extend this execution only; the recurring schedule remains an explicit edit. */
export async function addScheduleRunCollaborator(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const { principal, workspaceId } = readTrustedContext(request);
  const input = scheduleRunCollaboratorSchema.parse(await parseJson(request));
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requirePrincipalMember(principal);
  channels.requireAgentCapability(principal, "workspace.write");
  const run = storage.transactionSync(() => {
    const current = readScheduleRun(storage, input.runId);
    if (!current) throw new HttpError(404, "run_not_found", "Run not found.");
    const { run } = current;
    channels.requireChannelVisible(run.schedule.conversationId, principal);
    requireRunLead(principal, run.schedule.agentId);
    const existing = run.steps.find(
      (step) => step.phase === "contribute" && step.agentId === input.agentId,
    );
    if (existing) {
      if (existing.assignment !== input.assignment)
        throw new HttpError(
          409,
          "assignment_conflict",
          "This teammate already has a different assignment in this run.",
        );
      return run;
    }
    if (!scheduleRunIsActive(run))
      throw new HttpError(
        409,
        "run_team_closed",
        "This run has ended. Start another run to assign more work.",
      );
    if (
      input.agentId === run.schedule.agentId ||
      run.schedule.collaborators.length >= 12
    )
      throw new HttpError(
        400,
        "run_team_limit",
        "Choose a new collaborator; a run supports up to 12 collaborators.",
      );
    channels.requireWorkspaceMember("agent", input.agentId);
    requireAgentMessageAccess(channels, input.agentId, current.principal);
    if (!channels.agentIsLive(input.agentId))
      throw new HttpError(
        409,
        "run_agent_unavailable",
        "This teammate is unavailable.",
      );
    const mission = run.schedule.missionId
      ? readWorkspaceMission(storage, run.schedule.missionId)
      : undefined;
    if (
      mission &&
      ![mission.ownerAgentId, ...mission.collaborators].includes(input.agentId)
    )
      throw new HttpError(
        409,
        "mission_team_mismatch",
        "Add this teammate to the mission before adding them to its run.",
      );
    const schedule = {
      ...run.schedule,
      collaborators: [...run.schedule.collaborators, input.agentId],
      newChannel: undefined,
    };
    prepareScheduleChannel(channels, workspaceId, principal, schedule);
    run.schedule = schedule;
    // Keep the in-flight step identity so its completion still settles correctly.
    // A lead that delegates during its result turn must return after the new work.
    const finishing = run.steps.find(
      (step) => step.phase === "finish" && step.state === "running",
    );
    if (finishing) {
      finishing.phase = "plan";
      run.steps.push({
        id: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        agentId: run.schedule.agentId,
        phase: "finish",
        state: "pending",
      });
    }

    run.steps.splice(
      run.steps.findIndex((step) => step.phase === "finish"),
      0,
      {
        id: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        agentId: input.agentId,
        phase: "contribute",
        state: "pending",
        assignment: input.assignment,
      },
    );
    run.updatedAt = Date.now();
    run.nextCheckAt = Date.now();
    writeScheduleRun(storage, run, current.principal);
    return run;
  });
  await wakeWorkspaceSchedules(storage);
  return json(run);
}

function requireRunLead(principal: Principal, lead: string) {
  if (principal.kind !== "agent" || principal.agentId !== lead)
    throw new HttpError(
      403,
      "run_lead_required",
      "Only this run's lead agent can assign a new teammate.",
    );
}
