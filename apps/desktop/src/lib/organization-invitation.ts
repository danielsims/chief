import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

export const pendingOrganizationInvitationKey =
  "chief.pending-organization-invitation.v1";

export interface PendingOrganizationInvitation {
  relayUrl: string;
  workspaceId: string;
  channelId: string | null;
}

const channelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

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
  const channel = url.searchParams.get("channel") ?? "";
  return {
    relayUrl: relay.origin,
    workspaceId,
    channelId: channelIdPattern.test(channel) ? channel : null,
  };
}

export function storePendingOrganizationInvitation(
  invitation: PendingOrganizationInvitation,
) {
  window.sessionStorage.setItem(
    pendingOrganizationInvitationKey,
    JSON.stringify(invitation),
  );
}

/**
 * Reads the invitation saved before a reload and forgets it, unless it belongs
 * to a different relay than the one now connected.
 */
export function takePendingOrganizationInvitation(relayOrigin: string) {
  const stored = window.sessionStorage.getItem(
    pendingOrganizationInvitationKey,
  );
  if (!stored) return null;
  try {
    const parsed = parseJsonObject(JSON.parse(stored));
    if (
      !parsed ||
      !isJsonString(parsed.relayUrl) ||
      !isJsonString(parsed.workspaceId)
    ) {
      window.sessionStorage.removeItem(pendingOrganizationInvitationKey);
      return null;
    }
    const relay = new URL(parsed.relayUrl);
    assertSafeRelayOrigin(relay);
    if (relay.origin !== relayOrigin) return null;
    window.sessionStorage.removeItem(pendingOrganizationInvitationKey);
    if (!parsed.workspaceId.startsWith("workspace-")) return null;
    const channelId = isJsonString(parsed.channelId) ? parsed.channelId : null;
    return {
      relayUrl: relay.origin,
      workspaceId: parsed.workspaceId,
      channelId:
        channelId && channelIdPattern.test(channelId) ? channelId : null,
    };
  } catch {
    window.sessionStorage.removeItem(pendingOrganizationInvitationKey);
    return null;
  }
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
