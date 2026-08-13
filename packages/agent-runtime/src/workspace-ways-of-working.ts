import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  WorkspaceOperatingMode,
  WorkspaceWaysOfWorking,
} from "./types.js";
import { MISSION_CONTROL_CHANNEL_ID } from "./channels/nip29.js";
import { workspaceOperatingModes } from "./types.js";
import { writeWorkspaceContextValue } from "./workspace-context.js";
import { workspaceRoot } from "./workspace-secrets.js";

export const defaultWorkspaceWaysOfWorking: WorkspaceWaysOfWorking = {
  mode: "mission-control",
  missionControlChannelId: MISSION_CONTROL_CHANNEL_ID,
  updatedAt: 0,
};

function settingsPath(workspaceId: string) {
  return join(workspaceRoot(workspaceId), "ways-of-working.json");
}

function isOperatingMode(value: unknown): value is WorkspaceOperatingMode {
  return workspaceOperatingModes.includes(value as WorkspaceOperatingMode);
}

export function readWorkspaceWaysOfWorking(
  workspaceId: string,
): WorkspaceWaysOfWorking {
  try {
    const parsed = JSON.parse(
      readFileSync(settingsPath(workspaceId), "utf8"),
    ) as Partial<WorkspaceWaysOfWorking>;
    if (!isOperatingMode(parsed.mode)) return defaultWorkspaceWaysOfWorking;
    return {
      mode: parsed.mode,
      missionControlChannelId:
        typeof parsed.missionControlChannelId === "string" &&
        parsed.missionControlChannelId
          ? parsed.missionControlChannelId
          : MISSION_CONTROL_CHANNEL_ID,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return defaultWorkspaceWaysOfWorking;
  }
}

export function requiredWorkspaceChannelIds(workspaceId: string) {
  const waysOfWorking = readWorkspaceWaysOfWorking(workspaceId);
  return new Set([
    ...(waysOfWorking.mode === "mission-control" &&
    waysOfWorking.missionControlChannelId === MISSION_CONTROL_CHANNEL_ID
      ? [MISSION_CONTROL_CHANNEL_ID]
      : []),
  ]);
}

function modeContext(
  mode: WorkspaceOperatingMode,
  missionControlChannelId: string,
) {
  if (mode === "channels") {
    return [
      "Mode: Channels",
      "Keep work in durable subject channels and their threads. Create a temporary feature channel only when the user explicitly asks for one.",
    ].join("\n\n");
  }
  if (mode === "calm") {
    return [
      "Mode: Calm",
      "Work quietly in the current conversation. Use schedules for recurring work, create new feature channels only when asked, and notify the user only for a decision, blocker, review, or completed outcome.",
    ].join("\n\n");
  }
  return [
    "Mode: Mission control",
    `Mission channel ID: ${missionControlChannelId}`,
    "Use the assigned mission channel as the workspace's coordination home. Chief may assess the workspace and compose the existing channel, message, membership, schedule, file, action, and notification primitives as the situation requires. There is no prescribed project workflow, channel lifecycle, or requirement to post. If nothing useful needs attention, stay quiet.",
  ].join("\n\n");
}

export function saveWorkspaceWaysOfWorking(
  workspaceId: string,
  mode: WorkspaceOperatingMode,
  missionControlChannelId = MISSION_CONTROL_CHANNEL_ID,
): WorkspaceWaysOfWorking {
  if (!isOperatingMode(mode)) throw new Error("Unknown way of working.");
  if (!missionControlChannelId.trim()) {
    throw new Error("Choose a mission channel.");
  }
  const next = {
    mode,
    missionControlChannelId,
    updatedAt: Date.now(),
  } satisfies WorkspaceWaysOfWorking;
  const root = workspaceRoot(workspaceId);
  const path = settingsPath(workspaceId);
  const temporaryPath = `${path}.tmp`;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
  writeWorkspaceContextValue(
    workspaceId,
    "Ways of working",
    modeContext(mode, missionControlChannelId),
  );
  return next;
}
