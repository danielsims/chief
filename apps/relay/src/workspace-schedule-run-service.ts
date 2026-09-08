import {
  scheduleRunActionSchema,
  scheduleRunReportSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext, withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import {
  finishScheduleRun,
  listScheduleRuns,
  queueScheduleRun,
  readScheduleRun,
  scheduleRunIsActive,
  writeScheduleRun,
} from "./workspace-schedule-runs";
import {
  readWorkspaceSchedule,
  wakeWorkspaceSchedules,
} from "./workspace-schedule-store";
import { addScheduleRunCollaborator } from "./workspace-schedule-team";

export async function routeScheduleRuns(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
  operation: string,
) {
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requireWorkspace(context.workspaceId);
  channels.requirePrincipalMember(context.principal);
  if (operation === "schedules-runs-add-collaborator")
    return addScheduleRunCollaborator(storage, env, request);
  if (operation === "schedules-runs-report") {
    channels.requireAgentCapability(context.principal, "workspace.write");
    const input = scheduleRunReportSchema.parse(await parseJson(request));
    const current = readScheduleRun(storage, input.runId);
    if (!current) throw new HttpError(404, "run_not_found", "Run not found.");
    channels.requireChannelVisible(
      current.run.schedule.conversationId,
      context.principal,
    );
    const step = current.run.steps.find((step) => step.id === input.stepId);
    if (
      context.principal.kind !== "agent" ||
      context.principal.agentId !== step?.agentId
    )
      throw new HttpError(
        403,
        "run_step_owner",
        "Only the assigned agent can report this step.",
      );
    if (step.state === "completed") return json(current.run);
    const phase = ["plan", "contribute", "finish"].find((phase) =>
      current.run.steps.some(
        (step) => step.phase === phase && step.state !== "completed",
      ),
    );
    if (current.run.state !== "running" || phase !== step.phase)
      throw new HttpError(409, "run_step_inactive", "This step is not active.");
    if (input.status === "blocked")
      finishScheduleRun(storage, current.run.id, "blocked", input.evidence);
    else {
      step.state = "completed";
      step.completedAt = Date.now();
      step.evidence = input.evidence;
      current.run.summary = input.evidence;
      current.run.nextCheckAt = Date.now();
      writeScheduleRun(storage, current.run, current.principal);
    }
    await wakeWorkspaceSchedules(storage);
    return json(readScheduleRun(storage, current.run.id)?.run);
  }
  const scheduleId = request.headers.get("x-chief-schedule-id") ?? "";
  const schedule = readWorkspaceSchedule(storage, scheduleId);
  if (!schedule)
    throw new HttpError(404, "schedule_not_found", "Schedule not found.");
  channels.requireChannelVisible(
    schedule.schedule.conversationId,
    context.principal,
  );
  if (operation === "schedules-runs-list")
    return json({
      runs: listScheduleRuns(storage, scheduleId).filter((run) =>
        channels.canReadConversation(
          run.schedule.conversationId,
          context.principal,
        ),
      ),
    });
  requireWorkspaceAdministrator(channels, context.principal);
  const current = readScheduleRun(
    storage,
    request.headers.get("x-chief-run-id") ?? "",
  );
  if (!current || current.run.scheduleId !== scheduleId)
    throw new HttpError(404, "run_not_found", "Run not found.");
  channels.requireChannelVisible(
    current.run.schedule.conversationId,
    context.principal,
  );
  const { action, commandId } = scheduleRunActionSchema.parse(
    await parseJson(request),
  );
  if (action === "retry") {
    if (!["failed", "blocked", "cancelled"].includes(current.run.state))
      throw new HttpError(
        409,
        "run_not_retryable",
        "Only a failed, blocked or stopped run can be retried.",
      );
    if (!schedule.approvedBy)
      throw new HttpError(
        409,
        "schedule_unapproved",
        "Approve the schedule before retrying.",
      );
    const run = queueScheduleRun(
      storage,
      schedule.schedule,
      context.principal,
      {
        id: commandId,
        source: "retry",
        retryOf: current.run.id,
        scheduledAt: Date.now(),
        input: current.run.input,
      },
    );
    await wakeWorkspaceSchedules(storage);
    return json(run, { status: 202 });
  }
  if (scheduleRunIsActive(current.run))
    finishScheduleRun(
      storage,
      current.run.id,
      "cancelled",
      "Stopped by a workspace administrator.",
    );
  // Retrying this operation also retries delivery of the stop request.
  for (const agentId of new Set(
    current.run.steps.map((step) => step.agentId),
  )) {
    const response = await env.AGENTS.get(
      env.AGENTS.idFromName(`${context.workspaceId}:${agentId}`),
    ).fetch(
      withTrustedContext(
        new Request("https://agent.internal/cancel-workflow", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workflowId: current.run.threadRootId }),
        }),
        {
          principal: context.principal,
          workspaceId: workspaceIdSchema.parse(context.workspaceId),
          requestId: commandId,
        },
      ),
    );
    const ok = response.ok;
    await releaseInternalResponse(response);
    if (!ok)
      throw new HttpError(
        502,
        "run_stop_pending",
        "The run is stopped, but an agent has not acknowledged it. Retry Stop to finish notifying the team.",
      );
  }
  await wakeWorkspaceSchedules(storage);
  return json(readScheduleRun(storage, current.run.id)?.run);
}
