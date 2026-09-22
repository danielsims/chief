import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  Server,
  Settings2,
} from "lucide-react";

import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

import { connectedRelayIdentities } from "../lib/auth/account-directory";
import { useAuth } from "../lib/auth/auth-context";
import {
  CHIEF_CLOUD_AUTH_BASE_URL,
  CHIEF_CLOUD_AUTH_UI_URL,
  CHIEF_CLOUD_RELAY_URL,
  RELAY_URL,
  USING_CUSTOM_RELAY,
} from "../lib/config";
import {
  knownRelayConnections,
  validateRelayConnection,
} from "../lib/relay-connection";
import { ChiefMark } from "./chief-mark";

const HOST_SETUP_URL = "https://heychief.sh/host";

export function RelayConnectionControl({
  error,
  retrying = false,
  onRetry,
}: {
  error?: string | null;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="fixed top-9 right-4 z-50 flex items-center gap-2">
      {error ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs transition-colors"
            >
              <span className="bg-destructive size-1.5 shrink-0 rounded-full" />
              <span className="whitespace-nowrap">Connection unavailable</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            <p className="text-sm font-medium">
              Chief couldn’t reach this relay
            </p>
            <p className="text-muted-foreground mt-1.5 text-xs leading-5 break-words">
              {error}
            </p>
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
              <span className="text-muted-foreground min-w-0 truncate text-[11px]">
                {new URL(RELAY_URL).host}
              </span>
              {onRetry ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRetry}
                  disabled={retrying}
                  className="h-7 shrink-0 px-2 text-xs"
                >
                  {retrying ? "Connecting…" : "Try again"}
                </Button>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      <RelayConnectionDialog>
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors"
          aria-label="Connection settings"
        >
          <Settings2 size={15} />
        </button>
      </RelayConnectionDialog>
    </div>
  );
}

export function RelayConnectionDialog({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent className="max-w-[440px] gap-0 p-0">
        <RelayConnectionForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function RelayConnectionForm({ onDone }: { onDone?: () => void }) {
  const { connectRelay } = useAuth();
  const chiefCloud = {
    version: 1 as const,
    relayUrl: new URL(CHIEF_CLOUD_RELAY_URL).origin,
    authBaseUrl: new URL(CHIEF_CLOUD_AUTH_BASE_URL).origin,
    authUiUrl: new URL(CHIEF_CLOUD_AUTH_UI_URL).origin,
  };
  const connectedRelayUrls = new Set(
    connectedRelayIdentities().map((identity) => identity.relayUrl),
  );
  const savedRelays = [
    chiefCloud,
    ...knownRelayConnections().filter(
      (connection) =>
        connection.relayUrl !== chiefCloud.relayUrl &&
        connectedRelayUrls.has(connection.relayUrl),
    ),
  ];
  const [showsSelfHosted, setShowsSelfHosted] = useState(USING_CUSTOM_RELAY);
  const [relayUrl, setRelayUrl] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openHostSetup = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isTauri()) return;
    event.preventDefault();
    void openUrl(HOST_SETUP_URL).catch(() => {
      setError(
        "Could not open your browser. Visit https://heychief.sh/host to set up a relay.",
      );
    });
  };

  const connect = async (connection: (typeof savedRelays)[number]) => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await connectRelay(connection);
      onDone?.();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Chief could not connect to this relay.",
      );
      setWorking(false);
    }
  };

  const apply = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const connection = await validateRelayConnection(
        relayUrl,
        isTauri() ? tauriFetch : fetch,
      );
      await connectRelay(connection);
      onDone?.();
    } catch (caught) {
      console.error("[Connection] Relay validation failed:", caught);
      setError(
        caught instanceof Error
          ? caught.message
          : "Chief could not validate this relay.",
      );
      setWorking(false);
    }
  };

  return (
    <>
      <DialogHeader className="border-b px-5 py-5 pr-12">
        <DialogTitle>
          {showsSelfHosted ? "Self-hosted relay" : "Connection"}
        </DialogTitle>
        <DialogDescription>
          {showsSelfHosted
            ? "Host your own relay, then connect it to Chief."
            : "Choose a relay."}
        </DialogDescription>
      </DialogHeader>
      <div className="p-5">
        {!showsSelfHosted ? (
          <>
            <div className="mb-5">
              <p className="text-sm font-medium">Relays</p>
              <div className="mt-2 space-y-1">
                {savedRelays.map((connection) => {
                  const cloud = connection.relayUrl === chiefCloud.relayUrl;
                  const active =
                    connection.relayUrl === new URL(RELAY_URL).origin;
                  return (
                    <button
                      key={connection.relayUrl}
                      type="button"
                      disabled={working}
                      onClick={() => void connect(connection)}
                      className="hover:bg-accent flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-50"
                    >
                      {cloud ? (
                        <ChiefMark className="text-foreground size-4" />
                      ) : (
                        <Server className="text-muted-foreground size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">
                          {cloud
                            ? "Chief Cloud"
                            : new URL(connection.relayUrl).host}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {cloud ? "Managed by Chief" : "Self hosted"}
                        </span>
                      </span>
                      {active ? (
                        <Check className="text-muted-foreground size-4 shrink-0" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between"
              onClick={() => setShowsSelfHosted(true)}
              disabled={working}
            >
              Use a self-hosted relay
              <ChevronRight aria-hidden="true" className="size-4" />
            </Button>
          </>
        ) : (
          <div className="space-y-5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2"
              disabled={working}
              onClick={() => setShowsSelfHosted(false)}
            >
              <ArrowLeft aria-hidden="true" className="mr-1.5 size-4" />
              Back to relays
            </Button>
            <div className="space-y-3">
              <p className="text-sm font-medium">1. Host your relay</p>
              <p className="text-muted-foreground text-sm leading-5">
                Our setup guide walks you through deploying your own relay in
                your browser. Come back here when it’s ready.
              </p>
              <Button
                className="w-full"
                render={
                  <a
                    href={HOST_SETUP_URL}
                    onClick={openHostSetup}
                    rel="noreferrer"
                    target="_blank"
                  />
                }
              >
                Host a relay
                <ExternalLink aria-hidden="true" className="size-4" />
              </Button>
            </div>
            <div className="border-t pt-5">
              <label htmlFor="relay-url" className="text-sm font-medium">
                2. Add your relay URL
              </label>
              <p className="text-muted-foreground mt-1 text-sm leading-5">
                Already hosting a relay? Paste its URL below to connect.
              </p>
              <Input
                id="relay-url"
                value={relayUrl}
                onChange={(event) => setRelayUrl(event.target.value)}
                placeholder="https://chief.example.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mt-3"
                disabled={working}
              />
            </div>
          </div>
        )}

        {error ? (
          <p className="text-destructive mt-4 text-xs leading-5">{error}</p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          {onDone ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onDone}
              disabled={working}
            >
              Cancel
            </Button>
          ) : null}
          {showsSelfHosted ? (
            <Button
              type="button"
              onClick={() => void apply()}
              disabled={working || !relayUrl.trim()}
            >
              {working ? "Connecting…" : "Add relay"}
            </Button>
          ) : null}
        </div>
      </div>
    </>
  );
}
