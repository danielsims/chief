import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Check, Server, Settings2 } from "lucide-react";

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
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-[440px] gap-0 p-0">
        <DialogHeader className="border-b px-5 py-5 pr-12">
          <DialogTitle>Connection</DialogTitle>
          <DialogDescription>Choose a relay.</DialogDescription>
        </DialogHeader>
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
  const savedRelays = [
    chiefCloud,
    ...knownRelayConnections().filter(
      (connection) => connection.relayUrl !== chiefCloud.relayUrl,
    ),
  ];
  const [showsSelfHosted, setShowsSelfHosted] = useState(USING_CUSTOM_RELAY);
  const [relayUrl, setRelayUrl] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (connection: (typeof savedRelays)[number]) => {
    if (working) return;
    if (connection.relayUrl === new URL(RELAY_URL).origin) {
      onDone?.();
      return;
    }
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
      const nextRelay = connection.relayUrl;
      if (nextRelay === RELAY_URL && USING_CUSTOM_RELAY) {
        onDone?.();
        return;
      }
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
    <div className="p-5">
      <div className="mb-5">
        <p className="text-sm font-medium">Relays</p>
        <div className="mt-2 space-y-1">
          {savedRelays.map((connection) => {
            const cloud = connection.relayUrl === chiefCloud.relayUrl;
            const active = connection.relayUrl === new URL(RELAY_URL).origin;
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
                    {cloud ? "Chief Cloud" : new URL(connection.relayUrl).host}
                  </span>
                  {cloud ? (
                    <span className="text-muted-foreground block truncate text-xs">
                      Managed by Chief
                    </span>
                  ) : null}
                </span>
                {active ? (
                  <Check className="text-muted-foreground size-4 shrink-0" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      {!showsSelfHosted ? (
        <button
          type="button"
          onClick={() => setShowsSelfHosted(true)}
          className="text-muted-foreground hover:text-foreground flex w-full rounded-lg py-1 text-left text-sm transition-colors"
        >
          Use a self-hosted relay
        </button>
      ) : (
        <div>
          <label htmlFor="relay-url" className="text-sm font-medium">
            Add a relay
          </label>
          <Input
            id="relay-url"
            value={relayUrl}
            onChange={(event) => setRelayUrl(event.target.value)}
            placeholder="https://chief.example.com"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="mt-2"
          />
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
        <Button
          type="button"
          onClick={() => void apply()}
          disabled={working || !showsSelfHosted || !relayUrl.trim()}
        >
          {working ? "Connecting…" : "Add relay"}
        </Button>
      </div>
    </div>
  );
}
