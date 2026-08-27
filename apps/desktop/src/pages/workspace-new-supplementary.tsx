import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ArrowUpRight, Radar } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";

import type { StoredRelayConnection } from "../lib/relay-connection";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";
import { parseOrganizationInvitationUrl } from "../lib/organization-invitation";
import { validateRelayConnection } from "../lib/relay-connection";

const selfHostingGuideUrl =
  "https://github.com/danielsims/chief/blob/main/deploy/self-host/README.md";

export type LocalRelayDiscovery =
  | { status: "checking" }
  | { status: "found"; connection: StoredRelayConnection }
  | { status: "unavailable" };

let localRelayDiscovery: Promise<LocalRelayDiscovery> | undefined;

export function preloadLocalRelayDiscovery() {
  localRelayDiscovery ??= validateRelayConnection(
    "http://localhost:8080",
    (input, init) =>
      fetchWithTimeout(isTauri() ? tauriFetch : fetch, input, init, 1_500),
  )
    .then((connection) => ({ status: "found", connection }) as const)
    .catch(() => ({ status: "unavailable" }) as const);
  return localRelayDiscovery;
}

export function WorkspaceHostingChoice({
  relayUrl,
  localRelay,
  working,
  error,
  onRelayUrlChange,
  onBack,
  onSelfHosted,
}: {
  relayUrl: string;
  localRelay: LocalRelayDiscovery;
  working: boolean;
  error: string | null;
  onRelayUrlChange: (value: string) => void;
  onBack: () => void;
  onSelfHosted: () => void;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        disabled={working}
        className="text-muted-foreground hover:text-foreground mb-8 flex items-center gap-1.5 text-[13px] transition-colors disabled:opacity-50"
      >
        <ArrowLeft size={14} /> Back
      </button>
      <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
        Connect your relay
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        {localRelay.status === "found"
          ? "A Chief relay is already running on this Mac."
          : "Deploy Chief on infrastructure you control, then connect this app to its public address."}
      </p>

      {localRelay.status !== "unavailable" ? (
        <LocalRelaySignal state={localRelay.status} />
      ) : (
        <ol className="mt-8 space-y-4">
          <SelfHostingStep number="1">
            Install Docker, Node 24 and pnpm on your server, then clone Chief.
          </SelfHostingStep>
          <SelfHostingStep number="2">
            Run <InlineCode>pnpm self-host:init</InlineCode>, followed by{" "}
            <InlineCode>pnpm self-host:up</InlineCode>.
          </SelfHostingStep>
          <SelfHostingStep number="3">
            Confirm the relay health endpoint responds, then paste its public
            HTTPS address below.
          </SelfHostingStep>
        </ol>
      )}

      <button
        type="button"
        onClick={() => {
          if (isTauri()) void openUrl(selfHostingGuideUrl);
          else
            window.open(selfHostingGuideUrl, "_blank", "noopener,noreferrer");
        }}
        className="text-muted-foreground hover:text-foreground mt-5 inline-flex items-center gap-1.5 text-[13px] underline-offset-4 transition-colors hover:underline"
      >
        {localRelay.status === "found"
          ? "Self-hosting guide"
          : "Read the self-hosting guide"}
        <ArrowUpRight size={13} />
      </button>

      <div className="mt-8 border-t pt-6">
        <label htmlFor="create-relay-url" className="text-[13px] font-medium">
          Relay address
        </label>
        <Input
          id="create-relay-url"
          value={relayUrl}
          onChange={(event) => onRelayUrlChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && relayUrl.trim()) onSelfHosted();
          }}
          placeholder="https://relay.example.com"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-2"
          disabled={working}
          autoFocus
        />
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            onClick={onSelfHosted}
            disabled={working || !relayUrl.trim()}
            loading={working}
          >
            Connect relay
          </Button>
        </div>
      </div>
      {error ? (
        <p className="bg-destructive/5 text-destructive mt-4 rounded-lg px-3 py-2 text-xs leading-5">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function LocalRelaySignal({ state }: { state: "checking" | "found" }) {
  return (
    <div className="mt-8 flex items-center gap-4 rounded-xl border px-4 py-4">
      <span className="bg-muted relative flex size-10 shrink-0 items-center justify-center rounded-full">
        <span className="border-foreground/20 absolute inset-1 animate-ping rounded-full border" />
        <Radar className="relative size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">
          {state === "found" ? "Local relay found" : "Looking on this Mac…"}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs">
          {state === "found"
            ? "localhost:8080 is ready"
            : "Checking localhost:8080"}
        </span>
      </span>
    </div>
  );
}

function SelfHostingStep({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 text-[13px] leading-5">
      <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium">
        {number}
      </span>
      <span className="text-muted-foreground pt-0.5">{children}</span>
    </li>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-[11px]">
      {children}
    </code>
  );
}

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
