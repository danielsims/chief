import { randomUUID } from "node:crypto";

import type {
  AgentToolPermission,
  DriverType,
  RecurringWorkRecord,
  WorkspaceWaysOfWorking,
} from "./types.js";
import { channelChatId } from "./channels/nip29.js";
import { nextRunAt } from "./recurring-work.js";

export interface MissionControlHeartbeatManager {
  agentPreference(
    workspaceId: string,
    agentId: string,
  ): Promise<{ driver?: DriverType; model?: string } | undefined>;
  createRootChat(
    workspaceId: string,
    chatId: string,
    title: string,
    provider?: DriverType,
    model?: string,
  ): Promise<unknown>;
  recurringWorkByOperationKey(
    workspaceId: string,
    operationKey: string,
  ): Promise<RecurringWorkRecord | undefined>;
  saveRecurringWork(
    workspaceId: string,
    work: RecurringWorkRecord,
  ): Promise<unknown>;
  store: {
    channelStore(): {
      get(
        workspaceId: string,
        channelId: string,
      ): Promise<
        | {
            id: string;
            name: string;
            visibility?: "public" | "private" | "direct";
            lifecycle: "active" | "archived" | "pending_deletion";
          }
        | undefined
      >;
    };
  };
}

export const MISSION_CONTROL_HEARTBEAT_OPERATION_KEY =
  "chief-mission-control-heartbeat";
export const HEARTBEAT_MAX_PROMPT_ATTEMPTS = 3;

const HEARTBEAT_CRON = "0 9 * * *";
const HEARTBEAT_LOCAL_PERMISSIONS = [
  "workspace.write",
  "channels.read",
  "channels.create",
  "channels.update",
  "channels.archive",
  "members.read",
  "members.manage",
  "messages.read",
  "messages.send",
] as const satisfies readonly AgentToolPermission[];

const HEARTBEAT_INSTRUCTIONS = `Wake up as Chief and move the workspace forward.

Read the workspace context, open user actions, and enough recent channel and thread activity to understand what is happening now. There is no fixed checklist or prescribed project type. Choose the smallest meaningful next move based on the actual workspace.

You are not a status reporter. Never publish a passive recap of work that is already complete or unchanged. A successful heartbeat does one of these things:
- advances useful work directly;
- creates or reuses a focused channel, gives it a clear purpose, and wakes the right agent there;
- raises one concrete user action with localTools.actionRaise when only the user can unblock progress.

An action is genuine only when an already-attempted concrete task is blocked by a decision, approval, consent, or fact that only the user can supply. Never invent a menu of speculative next moves, ask the user to choose a priority merely to close the heartbeat, or turn completed onboarding into an action. Existing useful options can be mentioned in a quiet channel reply when relevant, but they are not blockers.

Use the mission channel for coordination, focused channels for delivery, and threads for the working record. Do not invent work, repeat an unchanged request, or wake an agent merely to appear active. Complete a substantive check before deciding there is nothing to do. If there is no meaningful move and no genuine user action, raise no action and close the heartbeat thread with one calm sentence that nothing needs the user's attention right now.`;

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
      instructions: HEARTBEAT_INSTRUCTIONS,
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
  manager: MissionControlHeartbeatManager,
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
