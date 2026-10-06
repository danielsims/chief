export interface InvitationLinkTarget {
  id: string;
  relay: string;
  workspace: string;
  channel?: string | null;
}

const workspaceIdPattern = /^workspace-[A-Za-z0-9][A-Za-z0-9._-]{0,118}$/u;
const channelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** A relay origin safe to hand to a native client: HTTPS, or loopback HTTP. */
export function safeRelayOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.username || url.password || url.hash || url.search) return null;
    if (url.pathname !== "" && url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isWorkspaceId(value: string): boolean {
  return workspaceIdPattern.test(value);
}

export function isChannelId(value: string): boolean {
  return channelIdPattern.test(value);
}

/** The browser page that reviews and accepts one invitation. */
export function invitationPath(target: InvitationLinkTarget): string {
  const params = new URLSearchParams({
    relay: target.relay,
    workspace: target.workspace,
  });
  if (target.channel) params.set("channel", target.channel);
  return `/invitations/${encodeURIComponent(target.id)}?${params.toString()}`;
}

/**
 * The deep link that sends an accepted invitation back into the app. The
 * desktop verifies the relay and workspace against what it has already
 * connected before switching.
 */
export function invitationDeepLink(
  scheme: "chief-desktop" | "chief-mobile",
  target: Pick<InvitationLinkTarget, "relay" | "workspace" | "channel">,
): string {
  const params = new URLSearchParams({
    relay: target.relay,
    workspace: target.workspace,
  });
  if (target.channel) params.set("channel", target.channel);
  return `${scheme}://organization-invite?${params.toString()}`;
}
