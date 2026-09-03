import { useCallback } from "react";

import type { RelayClient } from "@chief/relay-client";
import type {
  OnboardingStage,
  OnboardingTelemetryEvent,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import { commandIdSchema } from "@chief/relay-contracts";

import type { CreateWorkspaceDraft } from "./workspace-create-draft";
import { pendingCreateDraftKey } from "../lib/workspace-entry";
import {
  parseCreateWorkspaceDraft,
  readCreateWorkspaceDraft,
  workspaceDraft,
} from "./workspace-create-draft";

export type WorkspacePageMode = "home" | "create" | "eve" | "join";
export interface EveWorkspace {
  snapshot: WorkspaceSnapshot;
  client: RelayClient;
}

export type WorkspaceNewDraftOverrides = Partial<{
  step: number;
  eveWorkspaceId: string | null;
  eveAutoDeploy: boolean;
  page: "create" | "eve";
}>;

export const pendingInviteKey = "chief.pending-workspace-invite.v1";

const pendingVercelTokenPrefix = "chief.pending-vercel-token.v1:";

export function onboardingStage(
  mode: WorkspacePageMode,
  step: number,
  agentRuntime: CreateWorkspaceDraft["agentRuntime"] = "relay-cell",
): OnboardingStage | null {
  if (mode === "home") return "workspace-home";
  if (mode === "eve") return "workspace-create";
  if (mode !== "create") return null;
  const stages =
    agentRuntime === "vercel-eve"
      ? ([
          "workspace-profile",
          "agent-runtime",
          "workspace-create",
          "apps",
        ] satisfies OnboardingStage[])
      : ([
          "workspace-profile",
          "agent-runtime",
          "inference-provider",
          "apps",
        ] satisfies OnboardingStage[]);
  return stages[step] ?? null;
}

export function useOnboardingRecorder(
  client: RelayClient | null,
  commandId: string,
) {
  return useCallback(
    (
      event: OnboardingTelemetryEvent["event"],
      stage: OnboardingStage,
      details: Partial<OnboardingTelemetryEvent> = {},
    ) => {
      if (!client) return;
      void client
        .recordOnboardingEvent({
          sessionId: commandIdSchema.parse(commandId),
          stage,
          event,
          ...details,
        })
        .catch((error: unknown) => {
          console.warn("[Onboarding] Telemetry delivery failed:", error);
        });
    },
    [client, commandId],
  );
}

export function initialWorkspacePageMode(
  hasInvite: boolean,
  draft: CreateWorkspaceDraft | null,
  resumesCreate: boolean,
  addWorkspace = false,
): WorkspacePageMode {
  if (hasInvite) return "join";
  if (addWorkspace) return "home";
  if (draft?.eveAutoDeploy && draft.eveWorkspaceId) return "eve";
  return draft || resumesCreate ? "create" : "home";
}

export function shouldLoadEveDestinations(
  agentRuntime: CreateWorkspaceDraft["agentRuntime"],
  fromStep: number,
  toStep: number,
) {
  return agentRuntime === "vercel-eve" && fromStep === 1 && toStep === 2;
}

export function restoredWorkspaceDraft(restores: boolean, key: string) {
  if (!restores) return null;
  return (
    parseCreateWorkspaceDraft(
      window.sessionStorage.getItem(pendingCreateDraftKey),
    ) ?? readCreateWorkspaceDraft(key)
  );
}

export function resolveEveWorkspace(
  current: EveWorkspace | null,
  draft: CreateWorkspaceDraft | null,
  snapshot: WorkspaceSnapshot | null,
  client: RelayClient | null,
) {
  if (current) return current;
  if (
    !draft?.eveWorkspaceId ||
    snapshot?.id !== draft.eveWorkspaceId ||
    !client
  )
    return null;
  return { snapshot, client: client.forWorkspace(snapshot.id) };
}

export function eveProgressStep(
  mode: WorkspacePageMode,
  step: number,
  autoDeploy: boolean,
) {
  if (mode === "eve") return autoDeploy ? 3 : 2;
  return step;
}

export function readPendingVercelToken(key: string) {
  try {
    return window.sessionStorage.getItem(pendingVercelTokenPrefix + key) ?? "";
  } catch {
    return "";
  }
}

export function rememberPendingVercelToken(key: string, token: string) {
  const storageKey = pendingVercelTokenPrefix + key;
  try {
    if (token) window.sessionStorage.setItem(storageKey, token);
    else window.sessionStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

export function forgetPendingVercelToken(key: string) {
  try {
    window.sessionStorage.removeItem(pendingVercelTokenPrefix + key);
  } catch {
    return;
  }
}

export function persistWorkspaceCreateDraft(
  keys: { activeCreateKey: string; createDraftKey: string },
  draft: Parameters<typeof workspaceDraft>[0],
) {
  window.localStorage.setItem(
    keys.createDraftKey,
    JSON.stringify(workspaceDraft(draft)),
  );
  window.sessionStorage.setItem(keys.activeCreateKey, "active");
}
