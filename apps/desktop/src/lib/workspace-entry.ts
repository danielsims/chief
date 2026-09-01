export const pendingCreateRelayKey = "chief.pending-workspace-create-relay.v1";
export const pendingCreateDraftKey = "chief.pending-workspace-create-draft.v1";

export function activeWorkspaceCreateKey(draftKey: string) {
  return `chief.active-workspace-create.v1:${draftKey}`;
}

export function shouldRestoreWorkspaceCreate(
  activeSession: string | null,
  resumesRelaySwitch: boolean,
) {
  return activeSession === "active" || resumesRelaySwitch;
}

export function isExplicitWorkspaceEntry(search: string) {
  const query = new URLSearchParams(search);
  return (
    query.has("invite") ||
    query.has("organizationInvite") ||
    query.get("intent") === "add"
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
