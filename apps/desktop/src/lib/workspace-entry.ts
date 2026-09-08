export const pendingCreateRelayKey = "chief.pending-workspace-create-relay.v1";
export const pendingCreateDraftKey = "chief.pending-workspace-create-draft.v1";

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
    intent === "create"
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
