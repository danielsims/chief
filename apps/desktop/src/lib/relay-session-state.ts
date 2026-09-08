import type { RelayClient } from "@chief/relay-client";
import type {
  WorkspaceSnapshot,
  WorkspaceSummary,
} from "@chief/relay-contracts";

import {
  CHIEF_CLOUD_AUTH_BASE_URL,
  CHIEF_CLOUD_AUTH_UI_URL,
  CHIEF_CLOUD_RELAY_URL,
  RELAY_URL,
} from "./config";
import { knownWorkspaceSummaries } from "./relay-connection";

export interface RelaySessionState {
  accountId: string | null;
  client: RelayClient | null;
  snapshot: WorkspaceSnapshot | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  error: string | null;
}

export type RelayConnectionIntent = "foreground" | "background";

export function completeRelayConnection(
  current: RelaySessionState,
  next: RelaySessionState,
): RelaySessionState {
  const sameWorkspace =
    current.snapshot !== null &&
    next.snapshot !== null &&
    current.accountId === next.accountId &&
    current.snapshot.id === next.snapshot.id;
  return {
    ...next,
    client: sameWorkspace ? (current.client ?? next.client) : next.client,
  };
}

export function beginWorkspaceTransition(
  state: RelaySessionState,
): RelaySessionState {
  return { ...state, client: null, loading: true, error: null };
}

export function beginRelayConnection(
  state: RelaySessionState,
  accountId: string,
  intent: RelayConnectionIntent = "foreground",
): RelaySessionState {
  if (intent === "background" && state.accountId === accountId) {
    return state;
  }

  if (state.accountId !== accountId) {
    return {
      accountId,
      client: null,
      snapshot: null,
      workspaces: knownWorkspaceSummaries(RELAY_URL, accountId),
      loading: true,
      error: null,
    };
  }

  return {
    ...state,
    loading: state.snapshot === null,
    error: null,
  };
}

export function failRelayConnection(
  state: RelaySessionState,
  accountId: string,
  error: string,
  intent: RelayConnectionIntent,
): RelaySessionState {
  if (intent === "background" && state.accountId === accountId) {
    return state;
  }

  return {
    ...state,
    accountId,
    loading: false,
    error,
  };
}

export function workspaceSummaryFromSnapshot(
  snapshot: WorkspaceSnapshot,
): WorkspaceSummary {
  return {
    id: snapshot.id,
    name: snapshot.name,
    website: snapshot.website,
    imageURL: snapshot.imageURL,
    isActive: true,
    onboardingComplete: snapshot.onboardingComplete,
  };
}

export function initialRelaySessionState(
  accountId: string | null,
  sessionToken: string | null,
): RelaySessionState {
  return {
    accountId,
    client: null,
    snapshot: null,
    workspaces: knownWorkspaceSummaries(RELAY_URL, accountId),
    loading: Boolean(sessionToken),
    error: null,
  };
}

export function visibleRelaySessionState(
  state: RelaySessionState,
  accountId: string | null,
  sessionToken: string | null,
): RelaySessionState {
  return state.accountId === accountId
    ? state
    : initialRelaySessionState(accountId, sessionToken);
}

export function chiefCloudRelayConnection() {
  return {
    version: 1 as const,
    relayUrl: new URL(CHIEF_CLOUD_RELAY_URL).origin,
    authBaseUrl: new URL(CHIEF_CLOUD_AUTH_BASE_URL).origin,
    authUiUrl: new URL(CHIEF_CLOUD_AUTH_UI_URL).origin,
  };
}

export function directoryWorkspacesForSnapshot(
  accountId: string,
  snapshotId: string | null | undefined,
) {
  return knownWorkspaceSummaries(RELAY_URL, accountId).map((summary) => ({
    ...summary,
    isActive: summary.id === snapshotId,
  }));
}

export function workspacesAfterCreate(
  snapshot: WorkspaceSnapshot,
  workspaces: WorkspaceSummary[],
) {
  const summary = workspaceSummaryFromSnapshot(snapshot);
  return [
    summary,
    ...workspaces.filter((candidate) => candidate.id !== snapshot.id),
  ];
}

export function workspaceSwitchMemory({
  previousRelayUrl,
  previousWorkspaceId,
  targetRelayUrl,
  workspaceId,
}: {
  previousRelayUrl: string;
  previousWorkspaceId: string | undefined;
  targetRelayUrl: string;
  workspaceId: string;
}) {
  return {
    target: { workspaceId, relayUrl: targetRelayUrl },
    ...(previousWorkspaceId
      ? {
          previous: {
            workspaceId: previousWorkspaceId,
            relayUrl: previousRelayUrl,
          },
        }
      : undefined),
  };
}
