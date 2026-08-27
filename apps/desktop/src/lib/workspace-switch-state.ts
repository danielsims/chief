import type { WorkspaceSummary } from "@chief/relay-contracts";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

import { relayForWorkspace } from "./relay-connection";

const pendingWorkspaceSwitchKey = "chief.pending-workspace-switch.v1";
const previousWorkspaceSwitchKey = "chief.previous-workspace-switch.v1";
const lastConnectedWorkspaceKey = "chief.last-connected-workspace.v1";

interface StoredWorkspaceSwitch {
  version: 2;
  workspaceId: string;
  relayUrl: string;
}

function scopedKey(key: string, accountId: string) {
  return `${key}:${accountId}`;
}

function readSwitch(
  key: string,
  accountId: string,
): StoredWorkspaceSwitch | null {
  const storage =
    key === lastConnectedWorkspaceKey || key === previousWorkspaceSwitchKey
      ? globalThis.localStorage
      : window.sessionStorage;
  const raw = storage.getItem(scopedKey(key, accountId));
  if (!raw) return null;
  try {
    const value = parseJsonObject(JSON.parse(raw));
    if (
      value?.version === 2 &&
      isJsonString(value.workspaceId) &&
      isJsonString(value.relayUrl)
    ) {
      return {
        version: 2,
        workspaceId: value.workspaceId,
        relayUrl: new URL(value.relayUrl).origin,
      };
    }
  } catch {
    // Version 1 stored only the workspace ID. Resolve it from the directory.
  }
  const relayUrl = relayForWorkspace(accountId, raw);
  return relayUrl ? { version: 2, workspaceId: raw, relayUrl } : null;
}

function writeSwitch(
  key: string,
  accountId: string,
  value: Omit<StoredWorkspaceSwitch, "version">,
) {
  const storage =
    key === previousWorkspaceSwitchKey
      ? globalThis.localStorage
      : window.sessionStorage;
  storage.setItem(
    scopedKey(key, accountId),
    JSON.stringify({ version: 2, ...value }),
  );
}

export function pendingWorkspaceSwitch(accountId: string) {
  return readSwitch(pendingWorkspaceSwitchKey, accountId);
}

export function previousWorkspaceSwitch(accountId: string) {
  return readSwitch(previousWorkspaceSwitchKey, accountId);
}

export function rememberWorkspaceSwitch(
  accountId: string,
  input: {
    target: Omit<StoredWorkspaceSwitch, "version">;
    previous?: Omit<StoredWorkspaceSwitch, "version">;
  },
) {
  writeSwitch(pendingWorkspaceSwitchKey, accountId, input.target);
  if (input.previous)
    writeSwitch(previousWorkspaceSwitchKey, accountId, input.previous);
}

export function clearWorkspaceSwitch(accountId: string) {
  window.sessionStorage.removeItem(
    scopedKey(pendingWorkspaceSwitchKey, accountId),
  );
}

export function rememberConnectedWorkspace(
  accountId: string,
  value: Omit<StoredWorkspaceSwitch, "version">,
) {
  const current = readSwitch(lastConnectedWorkspaceKey, accountId);
  if (
    current &&
    (current.workspaceId !== value.workspaceId ||
      current.relayUrl !== value.relayUrl)
  ) {
    writeSwitch(previousWorkspaceSwitchKey, accountId, current);
  }
  globalThis.localStorage.setItem(
    scopedKey(lastConnectedWorkspaceKey, accountId),
    JSON.stringify({ version: 2, ...value }),
  );
}

export function findRecoveryWorkspace(
  accountId: string | null,
  workspaces: readonly WorkspaceSummary[],
  currentRelay: string,
) {
  if (!accountId) return null;
  const previous = previousWorkspaceSwitch(accountId);
  const previousWorkspace = previous
    ? workspaces.find(
        (workspace) =>
          workspace.id === previous.workspaceId &&
          relayForWorkspace(accountId, workspace.id, previous.relayUrl) ===
            previous.relayUrl,
      )
    : undefined;
  return (
    previousWorkspace ??
    workspaces.find(
      (workspace) =>
        workspace.isActive &&
        relayForWorkspace(accountId, workspace.id, currentRelay) !==
          currentRelay,
    ) ??
    null
  );
}
