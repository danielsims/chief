import type { WorkspaceSummary } from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";

import { relayForWorkspace } from "./relay-connection";

const pendingWorkspaceSwitchKey = "chief.pending-workspace-switch.v1";
const previousWorkspaceSwitchKey = "chief.previous-workspace-switch.v1";
const lastConnectedWorkspaceKey = "chief.last-connected-workspace.v1";

interface StoredWorkspaceSwitch {
  version: 2;
  workspaceId: string;
  relayUrl: string;
}

function readSwitch(key: string): StoredWorkspaceSwitch | null {
  const storage =
    key === lastConnectedWorkspaceKey || key === previousWorkspaceSwitchKey
      ? globalThis.localStorage
      : window.sessionStorage;
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredWorkspaceSwitch>;
    if (
      value.version === 2 &&
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
  const relayUrl = relayForWorkspace(raw);
  return relayUrl ? { version: 2, workspaceId: raw, relayUrl } : null;
}

function writeSwitch(
  key: string,
  value: Omit<StoredWorkspaceSwitch, "version">,
) {
  const storage =
    key === previousWorkspaceSwitchKey
      ? globalThis.localStorage
      : window.sessionStorage;
  storage.setItem(key, JSON.stringify({ version: 2, ...value }));
}

export function pendingWorkspaceSwitch() {
  return readSwitch(pendingWorkspaceSwitchKey);
}

export function previousWorkspaceSwitch() {
  return readSwitch(previousWorkspaceSwitchKey);
}

export function rememberWorkspaceSwitch(input: {
  target: Omit<StoredWorkspaceSwitch, "version">;
  previous?: Omit<StoredWorkspaceSwitch, "version">;
}) {
  writeSwitch(pendingWorkspaceSwitchKey, input.target);
  if (input.previous) writeSwitch(previousWorkspaceSwitchKey, input.previous);
}

export function clearWorkspaceSwitch() {
  window.sessionStorage.removeItem(pendingWorkspaceSwitchKey);
}

export function rememberConnectedWorkspace(
  value: Omit<StoredWorkspaceSwitch, "version">,
) {
  const current = readSwitch(lastConnectedWorkspaceKey);
  if (
    current &&
    (current.workspaceId !== value.workspaceId ||
      current.relayUrl !== value.relayUrl)
  ) {
    writeSwitch(previousWorkspaceSwitchKey, current);
  }
  globalThis.localStorage.setItem(
    lastConnectedWorkspaceKey,
    JSON.stringify({ version: 2, ...value }),
  );
}

export function findRecoveryWorkspace(
  workspaces: readonly WorkspaceSummary[],
  currentRelay: string,
) {
  const previous = previousWorkspaceSwitch();
  const previousWorkspace = previous
    ? workspaces.find(
        (workspace) =>
          workspace.id === previous.workspaceId &&
          relayForWorkspace(workspace.id) === previous.relayUrl,
      )
    : undefined;
  return (
    previousWorkspace ??
    workspaces.find(
      (workspace) =>
        workspace.isActive && relayForWorkspace(workspace.id) !== currentRelay,
    ) ??
    null
  );
}
