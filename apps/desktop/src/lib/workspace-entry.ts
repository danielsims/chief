export const pendingCreateRelayKey = "chief.pending-workspace-create-relay.v1";

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
