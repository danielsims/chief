import type { WorkspaceSchedule } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  appendMessageResultSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";
import { releaseInternalResponse } from "./internal-response";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { dispatchWorkspaceMessage } from "./workspace-agent-dispatch";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import {
  nextScheduleTime,
  readWorkspaceSchedule,
  readWorkspaceSchedules,
  writeWorkspaceSchedule,
} from "./workspace-schedule-store";

type DispatchRow = {
  id: string;
  schedule_id: string;
  scheduled_at: number;
  command_id: string;
  message_id: string;
  state: string;
  attempts: number;
} & Record<string, SqlStorageValue>;

export function enqueueScheduleOccurrence(
  storage: DurableObjectStorage,
  schedule: WorkspaceSchedule,
  scheduledAt: number,
  operationId: string,
) {
  storage.sql.exec(
    `INSERT OR IGNORE INTO workspace_schedule_dispatches
    (id, schedule_id, scheduled_at, command_id, message_id, state, retry_at, created_at, attempts)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0)`,
    operationId,
    schedule.id,
    scheduledAt,
    crypto.randomUUID(),
    crypto.randomUUID(),
    Date.now(),
    Date.now(),
  );
}

export async function drainWorkspaceSchedules(
  storage: DurableObjectStorage,
  env: Env,
) {
  const now = Date.now();
  for (const stored of readWorkspaceSchedules(storage)) {
    const { schedule } = stored;
    if (
      schedule.status !== "active" ||
      schedule.nextAt === undefined ||
      schedule.nextAt > now
    )
      continue;
    enqueueScheduleOccurrence(
      storage,
      schedule,
      schedule.nextAt,
      `${schedule.id}:${schedule.nextAt}`,
    );
    schedule.nextAt = nextScheduleTime(schedule, now);
    if (schedule.nextAt === undefined) schedule.status = "paused";
    schedule.updatedAt = now;
    writeWorkspaceSchedule(storage, stored);
  }
  const due = [
    ...storage.sql.exec<DispatchRow>(
      "SELECT * FROM workspace_schedule_dispatches WHERE state = 'pending' AND retry_at <= ? ORDER BY retry_at LIMIT 20",
      now,
    ),
  ];
  for (const occurrence of due) {
    const stored = readWorkspaceSchedule(storage, occurrence.schedule_id);
    if (!stored?.approvedBy) {
      storage.sql.exec(
        "UPDATE workspace_schedule_dispatches SET state = 'cancelled' WHERE id = ?",
        occurrence.id,
      );
      continue;
    }
    try {
      if (!(await dispatchSchedule(storage, env, occurrence, stored))) continue;
      storage.sql.exec(
        "UPDATE workspace_schedule_dispatches SET state = 'sent', error = NULL WHERE id = ?",
        occurrence.id,
      );
      const latest = readWorkspaceSchedule(storage, occurrence.schedule_id);
      if (latest) {
        latest.schedule.lastMessageId = occurrence.message_id;
        latest.schedule.lastDispatchedAt = Date.now();
        latest.schedule.lastSummary = `Sent to ${latest.schedule.agentId} in the channel.`;
        latest.schedule.updatedAt = Date.now();
        writeWorkspaceSchedule(storage, latest);
      }
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : "The scheduled work could not be sent.";
      const attempts = occurrence.attempts + 1;
      const terminal =
        attempts >= 5 || (error instanceof HttpError && error.status < 500);
      storage.sql.exec(
        "UPDATE workspace_schedule_dispatches SET state = ?, error = ?, retry_at = ?, attempts = ? WHERE id = ?",
        terminal ? "failed" : "pending",
        detail.slice(0, 2_000),
        Date.now() + Math.min(300_000, 5_000 * 2 ** attempts),
        attempts,
        occurrence.id,
      );
      const latest = readWorkspaceSchedule(storage, occurrence.schedule_id);
      if (latest) {
        latest.schedule.lastSummary = detail;
        if (terminal) latest.schedule.status = "error";
        latest.schedule.updatedAt = Date.now();
        writeWorkspaceSchedule(storage, latest);
      }
    }
  }
  storage.sql.exec(
    "DELETE FROM workspace_schedule_dispatches WHERE state != 'pending' AND created_at < ?",
    now - 90 * 86_400_000,
  );
}

async function dispatchSchedule(
  storage: DurableObjectStorage,
  env: Env,
  occurrence: DispatchRow,
  stored: NonNullable<ReturnType<typeof readWorkspaceSchedule>>,
) {
  const principal = stored.approvedBy;
  if (principal?.kind !== "user")
    throw new HttpError(
      403,
      "schedule_approval_missing",
      "This schedule needs user approval.",
    );
  const channels = new WorkspaceChannelStore(storage, env);
  requireWorkspaceAdministrator(channels, principal);
  const schedule = stored.schedule;
  channels.requireChannelVisible(schedule.conversationId, principal);
  if (
    !channels.channelMembership(
      schedule.conversationId,
      "agent",
      schedule.agentId,
    ) ||
    !channels.agentIsLive(schedule.agentId)
  )
    throw new HttpError(
      409,
      "schedule_agent_unavailable",
      "The scheduled agent is unavailable or no longer belongs to this channel.",
    );
  const workspaceId = workspaceIdSchema.parse(principal.workspaceId);
  const context = {
    principal,
    workspaceId,
    conversationId: schedule.conversationId,
    requestId: occurrence.command_id,
  };
  const command = appendMessageCommandSchema.parse({
    commandId: occurrence.command_id,
    protocolVersion: 1,
    occurredAt: new Date(occurrence.scheduled_at).toISOString(),
    payload: {
      messageId: occurrence.message_id,
      conversationId: schedule.conversationId,
      body: `Scheduled work: ${schedule.title}\n\n${schedule.instructions}\n\nReport what you changed, the evidence, and any blocker in this thread.`,
      mentions: [schedule.agentId],
    },
  });
  const response = await env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${workspaceId}:${schedule.conversationId}`),
  ).fetch(
    withTrustedContext(
      new Request(`https://conversation.internal/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      }),
      context,
    ),
  );
  if (!response.ok) {
    await releaseInternalResponse(response);
    throw new HttpError(
      502,
      "schedule_message_failed",
      "The scheduled message could not be saved.",
    );
  }
  const result = appendMessageResultSchema.parse(await response.json());
  const pending = [
    ...storage.sql.exec<DispatchRow>(
      "SELECT * FROM workspace_schedule_dispatches WHERE id = ? AND state = 'pending'",
      occurrence.id,
    ),
  ][0];
  if (!pending) return false;
  const dispatched = await dispatchWorkspaceMessage(
    storage,
    env,
    withTrustedContext(
      new Request("https://workspace.internal/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: result.message,
          workflowId: occurrence.message_id,
        }),
      }),
      context,
    ),
  );
  if (!dispatched.ok) {
    await releaseInternalResponse(dispatched);
    throw new HttpError(
      502,
      "schedule_dispatch_failed",
      "The scheduled agent could not be queued.",
    );
  }
  await releaseInternalResponse(dispatched);
  return true;
}
