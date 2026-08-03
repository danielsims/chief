import { Button } from "@chief/ui/components/button";

import { ChiefMark } from "../components/chief-mark";
import { useAuth } from "../lib/auth/auth-context";

/**
 * Full-window sign-in screen shown while signed out. Auth happens in the
 * system browser (PKCE); this screen starts the flow and waits.
 */
export function SignInScreen() {
  const { signIn, isSigningIn, authError } = useAuth();

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      {/* Empty drag strip under the macOS window controls */}
      <header data-tauri-drag-region className="h-[92px] shrink-0" />

      <main className="flex flex-1 items-center justify-center px-8 pb-[92px]">
        <div className="flex w-full max-w-xs flex-col items-center text-center">
          <ChiefMark className="text-foreground h-10 w-10" />
          <h1 className="mt-12 text-3xl leading-tight font-normal">
            Sign in to Chief
          </h1>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            Your agents and data stay on this machine.
          </p>
          <Button
            className="mt-12 h-11 w-full"
            onClick={signIn}
            disabled={isSigningIn}
          >
            {isSigningIn ? "Waiting for your browser…" : "Sign in"}
          </Button>
          <p className="text-muted-foreground/60 mt-3 h-4 text-xs">
            {isSigningIn
              ? "Finish signing in from the browser window."
              : "Sign-in opens in your browser."}
          </p>
          {authError ? (
            <p className="border-destructive/40 text-destructive mt-4 border px-3 py-2 text-xs leading-relaxed">
              {authError}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
