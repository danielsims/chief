export const pendingCreateRelayKey = "chief.pending-workspace-create-relay.v1";
export const pendingCreateDraftKey = "chief.pending-workspace-create-draft.v1";
export const pendingWorkspaceEntryIntentKey =
  "chief.pending-workspace-entry-intent.v1";

export function workspaceEntryIntent(search: string): "create" | "join" {
  const query = new URLSearchParams(search);
  return query.get("intent") === "join" ||
    query.has("invite") ||
    query.has("organizationInvite")
    ? "join"
    : "create";
}

/**
 * Leaving setup never turns an unfinished workspace into a usable one, but
 * its settings stay open so an abandoned setup can still be deleted.
 */
export function mustResumeWorkspaceSetup(
  workspace: { setupComplete?: boolean } | null,
  pathname: string,
) {
  return (
    workspace?.setupComplete === false &&
    pathname !== "/workspaces/new" &&
    pathname !== "/workspaces" &&
    !pathname.startsWith("/settings")
  );
}

function setupExitKey(relayUrl: string, accountId: string) {
  return `chief.workspace-setup-exit.v1:${new URL(relayUrl).origin}:${accountId}`;
}

export function workspaceSetupWasExited(
  storage: Pick<Storage, "getItem">,
  relayUrl: string,
  accountId: string,
  workspaceId: string | null,
) {
  return (
    storage.getItem(setupExitKey(relayUrl, accountId)) ===
    (workspaceId ?? "none")
  );
}

export function clearWorkspaceEntrySession(
  storage: Pick<Storage, "length" | "key" | "removeItem">,
) {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith("chief.active-workspace-create.v1:"))
      storage.removeItem(key);
  }
  storage.removeItem(pendingCreateRelayKey);
  storage.removeItem(pendingCreateDraftKey);
  storage.removeItem(pendingWorkspaceEntryIntentKey);
}

export function exitWorkspaceSetup(
  storage: Storage,
  relayUrl: string,
  accountId: string,
  workspaceId: string | null,
) {
  clearWorkspaceEntrySession(storage);
  storage.setItem(setupExitKey(relayUrl, accountId), workspaceId ?? "none");
}

export function resumeWorkspaceSetup(
  storage: Pick<Storage, "removeItem">,
  relayUrl: string,
  accountId: string,
) {
  storage.removeItem(setupExitKey(relayUrl, accountId));
}

export function activeWorkspaceCreateKey(draftKey: string) {
  return `chief.active-workspace-create.v1:${draftKey}`;
}

export function shouldRestoreWorkspaceCreate(
  activeSession: string | null,
  resumesRelaySwitch: boolean,
  startFresh = false,
) {
  if (startFresh) return false;
  return activeSession === "active" || resumesRelaySwitch;
}

export function isExplicitWorkspaceEntry(search: string) {
  const query = new URLSearchParams(search);
  const intent = query.get("intent");
  return (
    query.has("invite") ||
    query.has("organizationInvite") ||
    intent === "add" ||
    intent === "create" ||
    intent === "join"
  );
}

export function hasActiveWorkspaceCreateSession(storage: {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}) {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      key?.startsWith("chief.active-workspace-create.v1:") &&
      storage.getItem(key) === "active"
    ) {
      return true;
    }
  }
  return false;
}

export function shouldStayOnWorkspaceCreate(
  search: string,
  storage: {
    readonly length: number;
    key(index: number): string | null;
    getItem(key: string): string | null;
  },
) {
  return (
    isExplicitWorkspaceEntry(search) || hasActiveWorkspaceCreateSession(storage)
  );
}

export function shouldResumeWorkspaceCreate(
  pendingRelayUrl: string | null,
  currentRelayUrl: string,
) {
  if (!pendingRelayUrl) return false;
  try {
    return new URL(pendingRelayUrl).origin === new URL(currentRelayUrl).origin;
  } catch {
    return false;
  }
}
