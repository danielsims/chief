import type { Principal, WorkspaceSchedule } from "@chief/relay-contracts";
import { validateCron } from "@chief/agent-runtime/recurring-work";
import {
  agentIdSchema,
  automationAgents,
  workspaceScheduleActionSchema,
  workspaceScheduleInputSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { workspaceScheduleCommandsFindRouteWorkspaceSchedule } from "./queries/workspace-schedule-commands/find-route-workspace-schedule";
import { workspaceScheduleCommandsInsertRouteWorkspaceSchedule } from "./queries/workspace-schedule-commands/insert-route-workspace-schedule";
import { workspaceScheduleRunsListScheduledTimes } from "./queries/workspace-schedule-runs/list-scheduled-times";
import { workspaceSchedulesDeleteRouteWorkspaceSchedule } from "./queries/workspace-schedules/delete-route-workspace-schedule";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { requireAgentMessageAccess } from "./workspace-agent-messaging";
import { queueAutomationTest } from "./workspace-automation-agent";
import { validateAutomationForSave } from "./workspace-automation-validation";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { enqueueScheduleOccurrence } from "./workspace-schedule-dispatch";
import {
  cancelQueuedScheduleRuns,
  listScheduleRuns,
} from "./workspace-schedule-runs";
import { prepareScheduleChannel } from "./workspace-schedule-setup";
import {
  ensureWorkspaceAlarm,
  nextScheduleTime,
  presentWorkspaceSchedule,
  readWorkspaceSchedule,
  readWorkspaceSchedules,
  wakeWorkspaceSchedules,
  writeWorkspaceSchedule,
} from "./workspace-schedule-store";
import { deleteAutomationWebhook } from "./workspace-schedule-webhooks";

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
    await ensureWorkspaceAlarm(storage);
    const query = new URL(request.url).searchParams;
    const from = query.has("from")
      ? Number(query.get("from"))
      : Date.now() - 35 * 86_400_000;
    const to = query.has("to")
      ? Number(query.get("to"))
      : Date.now() + 86_400_000;
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      to <= from ||
      to - from > 93 * 86_400_000
    )
      throw new HttpError(
        400,
        "calendar_range_invalid",
        "Choose a calendar range of up to 93 days.",
      );
    return json({
      schedules: readWorkspaceSchedules(storage)
        .filter(({ schedule }) =>
          channels.canReadConversation(
            schedule.conversationId,
            context.principal,
          ),
        )
        .map(({ schedule }) => ({
          ...presentWorkspaceSchedule(schedule),
          recordedRuns: [
            ...new Set([
              ...workspaceScheduleRunsListScheduledTimes<{ at: number }>(
                storage,
                { scheduleId: schedule.id, from: from, to: to },
              ).map((row) => row.at),
              ...(schedule.onceAt !== undefined &&
              schedule.onceAt >= from &&
              schedule.onceAt < to &&
              schedule.onceAt <= Date.now()
                ? [schedule.onceAt]
                : []),
            ]),
          ],
        })),
    });
  }
  const id = request.headers.get("x-chief-schedule-id");
  if (operation === "schedules-save") {
    const input = workspaceScheduleInputSchema.parse(await parseJson(request));
    const result = storage.transactionSync(() => {
      if (context.principal.kind === "user")
        requireWorkspaceAdministrator(channels, context.principal);
      const previous = readWorkspaceSchedule(storage, input.id);
      if (previous)
        channels.requireChannelVisible(
          previous.schedule.conversationId,
          context.principal,
        );
      // Steps name the agents that work on them, so with steps they are the
      // team and can't drift from what actually runs.
      input.collaborators = [
        ...new Set(
          input.automation
            ? automationAgents(input.automation).map((agentId) =>
                agentIdSchema.parse(agentId),
              )
            : input.collaborators,
        ),
      ].filter((id) => id !== input.agentId);
      if (id && id !== input.id)
        throw new HttpError(
          409,
          "schedule_id_mismatch",
          "The schedule id does not match the request.",
        );
      prepareScheduleChannel(
        channels,
        context.workspaceId,
        context.principal,
        input,
      );
      try {
        new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
        if (input.onceAt === undefined && input.triggerMode === "cron") {
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
      validateAutomationForSave(storage, env, context.workspaceId, input);
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
          JSON.stringify(workspaceScheduleInputSchema.parse(input))
      )
        return json(presentWorkspaceSchedule(current.schedule));
      const userEditingApproved =
        context.principal.kind === "user" &&
        current?.approvedBy !== null &&
        current !== null;
      // A new title doesn't change what runs, so anyone may rename an
      // approved schedule without sending it back for review.
      const renamedOnly =
        current?.approvedBy != null &&
        JSON.stringify(
          workspaceScheduleInputSchema.parse({
            ...current.schedule,
            title: input.title,
          }),
        ) === JSON.stringify(workspaceScheduleInputSchema.parse(input));
      const now = Math.max(Date.now(), (current?.schedule.updatedAt ?? 0) + 1);
      const schedule: WorkspaceSchedule = {
        ...current?.schedule,
        ...input,
        status:
          current && (userEditingApproved || renamedOnly)
            ? current.schedule.status
            : "needs_approval",
        placement: "cloud",
        createdAt: current?.schedule.createdAt ?? now,
        updatedAt: now,
        upcomingRuns: [],
        recordedRuns: [],
      };
      if (schedule.status === "active")
        schedule.nextAt =
          input.triggerMode === "webhook"
            ? undefined
            : input.onceAt !== undefined
              ? Math.max(now, input.onceAt)
              : nextScheduleTime(schedule, now);
      writeWorkspaceSchedule(storage, {
        schedule,
        approvedBy: userEditingApproved
          ? context.principal
          : renamedOnly
            ? current.approvedBy
            : null,
      });
      return json(presentWorkspaceSchedule(schedule));
    });
    await wakeWorkspaceSchedules(storage);
    return result;
  }
  requireWorkspaceAdministrator(channels, context.principal);
  const actionRequest =
    operation === "schedules-delete"
      ? null
      : workspaceScheduleActionSchema.parse(await parseJson(request));
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
    workspaceSchedulesDeleteRouteWorkspaceSchedule(storage, stored.schedule.id);
    deleteAutomationWebhook(storage, stored.schedule.id);
    cancelQueuedScheduleRuns(storage, stored.schedule.id);
    await wakeWorkspaceSchedules(storage);
    return json({ deleted: true });
  }
  if (!actionRequest)
    throw new HttpError(
      404,
      "schedule_operation_missing",
      "This schedule operation does not exist.",
    );
  const { action, commandId, expectedUpdatedAt } = actionRequest;
  const previousCommand = [
    ...workspaceScheduleCommandsFindRouteWorkspaceSchedule<
      { schedule_id: string; action: string } & Record<string, SqlStorageValue>
    >(storage, commandId),
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
  if (
    (action === "approve" || action === "test") &&
    expectedUpdatedAt !== stored.schedule.updatedAt
  )
    throw new HttpError(
      409,
      "schedule_changed",
      "This schedule changed since you reviewed it. Review the latest version first.",
    );
  if (action === "approve" && stored.schedule.automation?.steps.length)
    requirePassingTest(storage, stored.schedule);
  if (
    action === "approve" ||
    action === "run" ||
    action === "resume" ||
    action === "test"
  ) {
    for (const agentId of [
      stored.schedule.agentId,
      ...stored.schedule.collaborators,
    ])
      requireAgentMessageAccess(channels, agentId, context.principal);
  }
  if (action === "test") {
    // A test leaves the schedule untouched so it still matches the version
    // that was tested.
    storage.transactionSync(() => {
      queueAutomationTest(
        storage,
        stored.schedule,
        context.principal,
        commandId,
      );
      workspaceScheduleCommandsInsertRouteWorkspaceSchedule(storage, {
        commandId,
        scheduleId: stored.schedule.id,
        action,
      });
    });
    await wakeWorkspaceSchedules(storage);
    return json(presentWorkspaceSchedule(stored.schedule));
  }
  const now = Math.max(Date.now(), stored.schedule.updatedAt + 1);
  storage.transactionSync(() => {
    if (action === "pause") {
      stored.schedule.status = "paused";
      delete stored.schedule.nextAt;
      cancelQueuedScheduleRuns(storage, stored.schedule.id);
    } else if (action === "approve") {
      stored.approvedBy = context.principal;
      stored.schedule.status = "active";
      stored.schedule.nextAt =
        stored.schedule.triggerMode === "webhook"
          ? undefined
          : stored.schedule.onceAt !== undefined
            ? Math.max(now, stored.schedule.onceAt)
            : nextScheduleTime(stored.schedule, now);
    } else {
      requireScheduleApproval(stored.approvedBy);
      if (action === "run") {
        enqueueScheduleOccurrence(storage, stored.schedule, now, commandId);
      } else {
        stored.schedule.status = "active";
        stored.schedule.nextAt =
          stored.schedule.triggerMode === "webhook"
            ? undefined
            : stored.schedule.onceAt !== undefined
              ? Math.max(now, stored.schedule.onceAt)
              : nextScheduleTime(stored.schedule, now);
      }
    }
    workspaceScheduleCommandsInsertRouteWorkspaceSchedule(storage, {
      commandId: commandId,
      scheduleId: stored.schedule.id,
      action: action,
    });
    stored.schedule.updatedAt = now;
    writeWorkspaceSchedule(storage, stored);
  });
  await wakeWorkspaceSchedules(storage);
  return json(presentWorkspaceSchedule(stored.schedule));
}

/** An automation with steps turns on only after its latest test, of this version, passed. */
function requirePassingTest(
  storage: DurableObjectStorage,
  schedule: WorkspaceSchedule,
) {
  const latestTest = listScheduleRuns(storage, schedule.id).find(
    (run) => run.test,
  );
  if (
    latestTest?.state !== "completed" ||
    latestTest.schedule.updatedAt !== schedule.updatedAt
  )
    throw new HttpError(
      409,
      "schedule_test_required",
      "Test this version of the automation before turning it on.",
    );
}

function requireScheduleApproval(principal: Principal | null) {
  if (!principal)
    throw new HttpError(
      409,
      "schedule_needs_approval",
      "Approve this schedule before running it.",
    );
}
