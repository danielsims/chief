import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

export const pendingOrganizationInvitationKey =
  "chief.pending-organization-invitation.v1";

export interface PendingOrganizationInvitation {
  relayUrl: string;
  workspaceId: string;
}

export function parseOrganizationInvitationUrl(
  value: string,
): PendingOrganizationInvitation {
  const url = new URL(value);
  if (
    url.protocol !== "chief-desktop:" ||
    url.hostname !== "organization-invite"
  ) {
    throw new Error("This workspace invitation is not valid.");
  }
  const relay = new URL(url.searchParams.get("relay") ?? "");
  assertSafeRelayOrigin(relay);
  const workspaceId = url.searchParams.get("workspace") ?? "";
  if (!workspaceId.startsWith("workspace-")) {
    throw new Error("This workspace invitation is not valid.");
  }
  return { relayUrl: relay.origin, workspaceId };
}

export function storePendingOrganizationInvitation(
  invitation: PendingOrganizationInvitation,
) {
  window.sessionStorage.setItem(
    pendingOrganizationInvitationKey,
    JSON.stringify(invitation),
  );
}

export function readPendingOrganizationInvitation() {
  try {
    const parsed = parseJsonObject(
      JSON.parse(
        window.sessionStorage.getItem(pendingOrganizationInvitationKey) ??
          "null",
      ),
    );
    if (
      !parsed ||
      !isJsonString(parsed.relayUrl) ||
      !isJsonString(parsed.workspaceId)
    ) {
      return null;
    }
    const relay = new URL(parsed.relayUrl);
    assertSafeRelayOrigin(relay);
    if (!parsed.workspaceId.startsWith("workspace-")) return null;
    return { relayUrl: relay.origin, workspaceId: parsed.workspaceId };
  } catch {
    window.sessionStorage.removeItem(pendingOrganizationInvitationKey);
    return null;
  }
}

export function clearPendingOrganizationInvitation() {
  window.sessionStorage.removeItem(pendingOrganizationInvitationKey);
}

function assertSafeRelayOrigin(url: URL) {
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  ) {
    throw new Error("This invitation points to an unsafe relay address.");
  }
}
