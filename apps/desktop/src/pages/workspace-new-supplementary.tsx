import { parseOrganizationInvitationUrl } from "../lib/organization-invitation";

export function parseIncomingOrganizationInvitation(value: string | null) {
  if (!value) return { invitation: null, error: null };
  try {
    return {
      invitation: parseOrganizationInvitationUrl(value),
      error: null,
    };
  } catch (error) {
    return {
      invitation: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseWorkspaceInvite(value: string) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.hash)
    throw new Error("This invitation link is not valid.");
  if (
    ["chief:", "chief-mobile:", "chief-desktop:"].includes(url.protocol) &&
    url.hostname === "join"
  ) {
    const relay = new URL(url.searchParams.get("relay") ?? "");
    assertSafeRelayOrigin(relay);
    return inviteParts(
      url.searchParams.get("workspace") ?? "",
      url.searchParams.get("code") ?? "",
      relay.origin,
    );
  }
  assertSafeRelayOrigin(url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts[0] !== "invite") {
    throw new Error("Paste a Chief workspace invitation link.");
  }
  return inviteParts(parts[1] ?? "", parts[2] ?? "", url.origin);
}

function inviteParts(workspaceId: string, secret: string, relayUrl: string) {
  if (
    !workspaceId.startsWith("workspace-") ||
    !/^[A-Za-z0-9_-]{43,128}$/u.test(secret)
  ) {
    throw new Error("This invitation link is not valid.");
  }
  return { workspaceId, secret, relayUrl };
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

export function ForeignRelayInvite({
  relayUrl,
  working,
  error,
  onCancel,
  onContinue,
}: {
  relayUrl: string;
  working: boolean;
  error: string | null;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <section>
      <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
        Join this workspace?
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        This invitation is hosted outside your current Chief connection.
      </p>
      <div className="mt-8 rounded-xl border px-4 py-4">
        <p className="text-sm font-medium">
          Check the relay before you continue
        </p>
        <p className="text-muted-foreground mt-2 font-mono text-xs break-all">
          {new URL(relayUrl).host}
        </p>
        <p className="text-muted-foreground mt-3 text-xs leading-5">
          Chief will verify this relay and ask you to authenticate with its
          account issuer. Your other relay connections stay on this device.
        </p>
      </div>
      {error ? <p className="text-destructive mt-4 text-xs">{error}</p> : null}
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={working}
          className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={working}
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {working ? "Checking relay…" : "Continue"}
        </button>
      </div>
    </section>
  );
}
