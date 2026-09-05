import type { Principal, WorkspaceSchedule } from "@chief/relay-contracts";
import { validateCron } from "@chief/agent-runtime/recurring-work";
import {
  workspaceScheduleActionSchema,
  workspaceScheduleInputSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { enqueueScheduleOccurrence } from "./workspace-schedule-dispatch";
import {
  nextScheduleTime,
  presentWorkspaceSchedule,
  readWorkspaceSchedule,
  readWorkspaceSchedules,
  wakeWorkspaceSchedules,
  writeWorkspaceSchedule,
} from "./workspace-schedule-store";

export async function routeWorkspaceSchedule(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
  operation: string,
) {
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requireWorkspace(context.workspaceId);
  channels.requirePrincipalMember(context.principal);
  channels.requireAgentCapability(
    context.principal,
    operation === "schedules-list" ? "workspace.read" : "workspace.write",
  );
  if (operation === "schedules-list") {
    return json({
      schedules: readWorkspaceSchedules(storage)
        .filter(({ schedule }) =>
          channels.canReadConversation(
            schedule.conversationId,
            context.principal,
          ),
        )
        .map(({ schedule }) => presentWorkspaceSchedule(schedule)),
    });
  }
  const id = request.headers.get("x-chief-schedule-id");
  if (operation === "schedules-save") {
    const input = workspaceScheduleInputSchema.parse(await parseJson(request));
    if (id && id !== input.id)
      throw new HttpError(
        409,
        "schedule_id_mismatch",
        "The schedule id does not match the request.",
      );
    channels.requireChannelVisible(input.conversationId, context.principal);
    if (!channels.memberRole("agent", input.agentId))
      throw new HttpError(
        404,
        "schedule_agent_missing",
        "Choose an agent in this workspace.",
      );
    if (
      !channels.channelMembership(input.conversationId, "agent", input.agentId)
    )
      throw new HttpError(
        409,
        "schedule_agent_not_in_channel",
        "Add the agent to this channel before scheduling work.",
      );
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
      if (input.onceAt === undefined) {
        if (input.cron.split(/\s+/u).length !== 5)
          throw new Error("Use a five-field cron expression.");
        validateCron(input.cron, input.timezone);
      }
    } catch (error) {
      throw new HttpError(
        400,
        "schedule_time_invalid",
        error instanceof Error
          ? error.message
          : "Choose a valid schedule and timezone.",
      );
    }
    const current = readWorkspaceSchedule(storage, input.id);
    if (!current && readWorkspaceSchedules(storage).length >= 250)
      throw new HttpError(
        409,
        "schedule_limit",
        "This workspace already has 250 schedules. Remove unused schedules before adding more.",
      );
    if (current)
      channels.requireChannelVisible(
        current.schedule.conversationId,
        context.principal,
      );
    if (context.principal.kind === "user")
      requireWorkspaceAdministrator(channels, context.principal);
    if (
      current &&
      JSON.stringify(workspaceScheduleInputSchema.parse(current.schedule)) ===
        JSON.stringify(input)
    )
      return json(presentWorkspaceSchedule(current.schedule));
    const userEditingApproved =
      context.principal.kind === "user" &&
      current?.approvedBy !== null &&
      current !== null;
    const now = Math.max(Date.now(), (current?.schedule.updatedAt ?? 0) + 1);
    const schedule: WorkspaceSchedule = {
      ...current?.schedule,
      ...input,
      status: userEditingApproved ? current.schedule.status : "needs_approval",
      placement: "cloud",
      createdAt: current?.schedule.createdAt ?? now,
      updatedAt: now,
      upcomingRuns: [],
    };
    if (schedule.status === "active")
      schedule.nextAt =
        input.onceAt !== undefined
          ? Math.max(now, input.onceAt)
          : nextScheduleTime(schedule, now);
    storage.sql.exec(
      "UPDATE workspace_schedule_dispatches SET state = 'cancelled' WHERE schedule_id = ? AND state = 'pending'",
      input.id,
    );
    writeWorkspaceSchedule(storage, {
      schedule,
      approvedBy: userEditingApproved ? context.principal : null,
    });
    await wakeWorkspaceSchedules(storage);
    return json(presentWorkspaceSchedule(schedule));
  }
  requireWorkspaceAdministrator(channels, context.principal);
  const stored = id ? readWorkspaceSchedule(storage, id) : null;
  if (!stored)
    throw new HttpError(
      404,
      "schedule_not_found",
      "This schedule no longer exists.",
    );
  channels.requireChannelVisible(
    stored.schedule.conversationId,
    context.principal,
  );
  if (operation === "schedules-delete") {
    storage.sql.exec(
      "DELETE FROM workspace_schedules WHERE id = ?",
      stored.schedule.id,
    );
    storage.sql.exec(
      "UPDATE workspace_schedule_dispatches SET state = 'cancelled' WHERE schedule_id = ? AND state = 'pending'",
      stored.schedule.id,
    );
    await wakeWorkspaceSchedules(storage);
    return json({ deleted: true });
  }
  const { action, commandId, expectedUpdatedAt } =
    workspaceScheduleActionSchema.parse(await parseJson(request));
  const previousCommand = [
    ...storage.sql.exec<
      { schedule_id: string; action: string } & Record<string, SqlStorageValue>
    >(
      "SELECT schedule_id, action FROM workspace_schedule_commands WHERE command_id = ?",
      commandId,
    ),
  ][0];
  if (previousCommand) {
    if (
      previousCommand.schedule_id !== stored.schedule.id ||
      previousCommand.action !== action
    )
      throw new HttpError(
        409,
        "schedule_command_conflict",
        "This command id was used for a different schedule action.",
      );
    return json(presentWorkspaceSchedule(stored.schedule));
  }
  if (action === "approve" && expectedUpdatedAt !== stored.schedule.updatedAt)
    throw new HttpError(
      409,
      "schedule_changed",
      "This schedule changed since you reviewed it. Review the latest version before approving.",
    );
  const now = Math.max(Date.now(), stored.schedule.updatedAt + 1);
  if (action === "pause") {
    stored.schedule.status = "paused";
    delete stored.schedule.nextAt;
    storage.sql.exec(
      "UPDATE workspace_schedule_dispatches SET state = 'cancelled' WHERE schedule_id = ? AND state = 'pending'",
      stored.schedule.id,
    );
  } else if (action === "approve") {
    stored.approvedBy = context.principal;
    stored.schedule.status = "active";
    stored.schedule.nextAt =
      stored.schedule.onceAt !== undefined
        ? Math.max(now, stored.schedule.onceAt)
        : nextScheduleTime(stored.schedule, now);
  } else {
    requireScheduleApproval(stored.approvedBy);
    if (action === "run") {
      enqueueScheduleOccurrence(storage, stored.schedule, now, commandId);
    } else {
      stored.schedule.status = "active";
      stored.schedule.nextAt =
        stored.schedule.onceAt !== undefined
          ? Math.max(now, stored.schedule.onceAt)
          : nextScheduleTime(stored.schedule, now);
    }
  }
  storage.sql.exec(
    "INSERT INTO workspace_schedule_commands(command_id, schedule_id, action) VALUES (?, ?, ?)",
    commandId,
    stored.schedule.id,
    action,
  );
  stored.schedule.updatedAt = now;
  writeWorkspaceSchedule(storage, stored);
  await wakeWorkspaceSchedules(storage);
  return json(presentWorkspaceSchedule(stored.schedule));
}

function requireScheduleApproval(principal: Principal | null) {
  if (!principal)
    throw new HttpError(
      409,
      "schedule_needs_approval",
      "Approve this schedule before running it.",
    );
}
