import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Pencil } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";

import { ChiefMark } from "../components/chief-mark";
import { useAuth } from "../lib/auth/auth-context";
import {
  CHIEF_CLOUD_AUTH_BASE_URL,
  CHIEF_CLOUD_AUTH_UI_URL,
  CHIEF_CLOUD_RELAY_URL,
  RELAY_URL,
  USING_CUSTOM_RELAY,
} from "../lib/config";
import { validateRelayConnection } from "../lib/relay-connection";

const chiefCloudAddress = "https://heychief.sh";
const chiefCloudConnection = {
  version: 1 as const,
  relayUrl: new URL(CHIEF_CLOUD_RELAY_URL).origin,
  authBaseUrl: new URL(CHIEF_CLOUD_AUTH_BASE_URL).origin,
  authUiUrl: new URL(CHIEF_CLOUD_AUTH_UI_URL).origin,
};

/**
 * Full-window sign-in screen shown while signed out. Auth happens in the
 * system browser (PKCE); this screen starts the flow and waits.
 */
export function SignInScreen() {
  const { connectRelay, isSigningIn, authError } = useAuth();
  const [showCustomRelay, setShowCustomRelay] = useState(false);
  const [relayAddress, setRelayAddress] = useState(
    USING_CUSTOM_RELAY ? RELAY_URL : "",
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isCheckingRelay, setIsCheckingRelay] = useState(false);
  const working = isSigningIn || isCheckingRelay;

  const connectChiefCloud = async () => {
    if (working) return;
    setConnectionError(null);
    setIsCheckingRelay(true);
    try {
      await connectRelay(chiefCloudConnection);
    } catch (caught) {
      setConnectionError(
        caught instanceof Error
          ? caught.message
          : "Chief could not open secure sign-in.",
      );
    } finally {
      setIsCheckingRelay(false);
    }
  };

  const connectCustomRelay = async () => {
    if (working) return;
    setConnectionError(null);
    setIsCheckingRelay(true);
    try {
      const candidate = relayAddress.trim();
      const candidateUrl = /^https?:\/\//iu.test(candidate)
        ? new URL(candidate)
        : new URL(`https://${candidate}`);
      const isChiefCloud =
        candidateUrl.origin === new URL(chiefCloudAddress).origin ||
        candidateUrl.origin === chiefCloudConnection.relayUrl;
      const connection = isChiefCloud
        ? chiefCloudConnection
        : await validateRelayConnection(
            candidate,
            isTauri() ? tauriFetch : fetch,
          );
      await connectRelay(connection);
    } catch (caught) {
      setConnectionError(
        caught instanceof Error
          ? caught.message
          : "Chief could not connect to this relay.",
      );
    } finally {
      setIsCheckingRelay(false);
    }
  };

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      {/* Empty drag strip under the macOS window controls */}
      <header data-tauri-drag-region className="h-16 shrink-0" />

      <main className="flex flex-1 items-center justify-center px-8 pb-16">
        <div className="flex w-full max-w-xs flex-col items-center text-center">
          <ChiefMark className="text-foreground h-10 w-10" />
          <h1 className="mt-10 text-3xl leading-tight font-normal">
            {showCustomRelay ? "Connect to Chief" : "Welcome to Chief"}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            {showCustomRelay
              ? "Enter the address of your self-hosted relay."
              : "Sign in to access your workspaces."}
          </p>
          {showCustomRelay ? (
            <div className="mt-8 w-full">
              <label
                htmlFor="sign-in-relay"
                className="text-muted-foreground block text-left text-xs font-medium"
              >
                Relay address
              </label>
              <Input
                id="sign-in-relay"
                value={relayAddress}
                onChange={(event) => setRelayAddress(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void connectCustomRelay();
                }}
                placeholder="relay.example.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="mt-2 h-10"
                disabled={working}
                autoFocus
              />
              <Button
                className="mt-3 h-10 w-full"
                onClick={() => void connectCustomRelay()}
                disabled={working || !relayAddress.trim()}
              >
                {isSigningIn
                  ? "Waiting for your browser…"
                  : isCheckingRelay
                    ? "Checking relay…"
                    : "Connect"}
              </Button>
              <Button
                variant="link"
                size="sm"
                className="text-muted-foreground mt-2"
                disabled={working}
                onClick={() => {
                  setConnectionError(null);
                  setShowCustomRelay(false);
                }}
              >
                Back
              </Button>
            </div>
          ) : (
            <>
              <Button
                className="mt-8 h-10 w-full"
                onClick={() => void connectChiefCloud()}
                disabled={working}
              >
                {isSigningIn
                  ? "Waiting for your browser…"
                  : isCheckingRelay
                    ? "Connecting…"
                    : "Sign in"}
              </Button>
              <TooltipProvider delayDuration={250}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Use another relay"
                      className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mt-3 flex h-7 items-center gap-2 rounded-md px-2 text-[12px] leading-4 font-normal transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                      disabled={working}
                      onClick={() => {
                        setConnectionError(null);
                        setShowCustomRelay(true);
                      }}
                    >
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-emerald-500"
                      />
                      <span>Chief Cloud</span>
                      <span className="text-muted-foreground/50">·</span>
                      <span>heychief.sh</span>
                      <Pencil
                        aria-hidden
                        size={11}
                        className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    sideOffset={6}
                    className="bg-foreground text-background [&>svg]:fill-foreground"
                  >
                    Use another relay
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
          {(connectionError ?? authError) ? (
            <p className="bg-destructive/5 text-destructive mt-4 w-full rounded-lg px-3 py-2 text-xs leading-relaxed">
              {connectionError ?? authError}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
