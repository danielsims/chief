import { randomUUID } from "node:crypto";

import type { SessionManager } from "./manager.js";
import type {
  AgentToolPermission,
  RecurringWorkRecord,
  WorkspaceWaysOfWorking,
} from "./types.js";
import { channelChatId } from "./channels/nip29.js";
import { nextRunAt } from "./recurring-work.js";

export const MISSION_CONTROL_HEARTBEAT_OPERATION_KEY =
  "chief-mission-control-heartbeat";

const HEARTBEAT_CRON = "0 9 * * *";
const HEARTBEAT_LOCAL_PERMISSIONS = [
  "channels.read",
  "channels.create",
  "channels.update",
  "channels.archive",
  "members.read",
  "members.manage",
  "messages.read",
  "messages.send",
] as const satisfies readonly AgentToolPermission[];

const HEARTBEAT_INSTRUCTIONS = `Wake up as Chief and assess the workspace.

Read the workspace context and enough recent activity to understand what is happening now. Decide whether there is a useful next action. There is no fixed checklist or required workflow. Use the available channel and message primitives only when they help the actual situation. You may wake a relevant agent, continue useful work yourself, or leave the workspace alone.

The assigned mission channel is the coordination home, not a required output destination. Do not invent work, publish a routine status update, repeat an unchanged request, or wake an agent just to appear active. If nothing meaningful needs attention, do nothing and send nothing.`;

function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function activeHeartbeat(
  existing: RecurringWorkRecord | undefined,
  workspaceId: string,
  missionControlChannelId: string,
): RecurringWorkRecord {
  const now = Date.now();
  if (existing) {
    const status =
      existing.status === "needs_approval" ? "needs_approval" : "active";
    const eventDriven =
      existing.trigger !== undefined &&
      !["cron", "once"].includes(existing.trigger.type);
    return {
      ...existing,
      conversationId: channelChatId(workspaceId, missionControlChannelId),
      status,
      nextAt:
        status === "active" && !eventDriven
          ? (existing.nextAt ??
            nextRunAt(existing.cron, existing.timezone, now))
          : undefined,
      grant: {
        version: 1,
        approvedAt: existing.grant?.approvedAt ?? now,
        toolPatterns: [],
        localToolPermissions: [...HEARTBEAT_LOCAL_PERMISSIONS],
      },
      notificationPolicy: "attention-only",
      updatedAt: now,
    };
  }
  const timezone = localTimezone();
  return {
    id: randomUUID(),
    conversationId: channelChatId(workspaceId, missionControlChannelId),
    agentId: "chief",
    title: "Chief heartbeat",
    instructions: HEARTBEAT_INSTRUCTIONS,
    cron: HEARTBEAT_CRON,
    timezone,
    trigger: { type: "cron", expression: HEARTBEAT_CRON, timezone },
    operationKey: MISSION_CONTROL_HEARTBEAT_OPERATION_KEY,
    version: 1,
    notificationPolicy: "attention-only",
    status: "active",
    placement: "local",
    approvalSummary:
      "Chief checks the workspace and acts only when there is meaningful work to move.",
    proposedToolPatterns: [],
    grant: {
      version: 1,
      approvedAt: now,
      toolPatterns: [],
      localToolPermissions: [...HEARTBEAT_LOCAL_PERMISSIONS],
    },
    nextAt: nextRunAt(HEARTBEAT_CRON, timezone, now),
    createdAt: now,
    updatedAt: now,
  };
}

/** Keeps the single Chief heartbeat aligned with the workspace setting. */
export async function syncMissionControlHeartbeat(
  manager: SessionManager,
  workspaceId: string,
  waysOfWorking: WorkspaceWaysOfWorking,
) {
  const existing = await manager.recurringWorkByOperationKey(
    workspaceId,
    MISSION_CONTROL_HEARTBEAT_OPERATION_KEY,
  );
  if (waysOfWorking.mode === "mission-control") {
    const preference = await manager.agentPreference(workspaceId, "chief");
    if (!preference?.driver) return;
    const channel = await manager.store
      .channelStore()
      .get(workspaceId, waysOfWorking.missionControlChannelId);
    if (
      !channel ||
      channel.visibility === "direct" ||
      channel.lifecycle !== "active"
    ) {
      throw new Error("The mission channel is not available.");
    }
    await manager.createRootChat(
      workspaceId,
      channelChatId(workspaceId, channel.id),
      channel.name,
      preference.driver,
      preference.model,
    );
    await manager.saveRecurringWork(
      workspaceId,
      activeHeartbeat(
        existing,
        workspaceId,
        waysOfWorking.missionControlChannelId,
      ),
    );
    return;
  }
  if (!existing || existing.status === "paused") return;
  await manager.saveRecurringWork(workspaceId, {
    ...existing,
    status: "paused",
    nextAt: undefined,
    updatedAt: Date.now(),
  });
}
