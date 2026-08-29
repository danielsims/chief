import { RadioTower } from "lucide-react";

import { Button } from "@chief/ui/components/button";

import { ChiefMark } from "../components/chief-mark";
import { RelayConnectionDialog } from "../components/relay-connection-control";
import { useAuth } from "../lib/auth/auth-context";

/** Full-window account sign-in. Relay connections are managed inside Chief. */
export function SignInScreen() {
  const { signIn, isSigningIn, authError } = useAuth();

  return (
    <div className="bg-background text-foreground relative flex min-h-screen flex-col">
      <header data-tauri-drag-region className="h-16 shrink-0">
        <div
          className="absolute top-7 right-4 z-10"
          data-tauri-drag-region="false"
        >
          <RelayConnectionDialog>
            <button
              type="button"
              aria-label="Connect a self-hosted relay"
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center rounded-[10px] transition-colors"
            >
              <RadioTower size={14} />
            </button>
          </RelayConnectionDialog>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-8 pb-16">
        <div className="flex w-full max-w-xs flex-col items-center text-center">
          <ChiefMark className="text-foreground h-10 w-10" />
          <h1 className="mt-10 text-3xl leading-tight font-normal">
            Welcome to Chief
          </h1>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Sign in to access your workspaces.
          </p>
          <Button
            className="mt-8 h-10 w-full"
            onClick={signIn}
            disabled={isSigningIn}
          >
            {isSigningIn ? "Waiting for your browser…" : "Sign in"}
          </Button>
          {authError ? (
            <p className="bg-destructive/5 text-destructive mt-4 w-full rounded-lg px-3 py-2 text-xs leading-relaxed">
              {authError}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
