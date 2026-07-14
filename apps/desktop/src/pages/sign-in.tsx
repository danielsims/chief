import { Button } from "@chief/ui/components/button";
import { useAuth } from "../lib/auth/auth-context";
import { ChiefMark } from "../components/chief-mark";

/**
 * Full-window sign-in screen shown while signed out. Auth happens in the
 * system browser (PKCE); this screen starts the flow and waits.
 */
export function SignInScreen() {
  const { signIn, isSigningIn, authError } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Empty drag strip under the macOS window controls */}
      <header data-tauri-drag-region className="h-[92px] shrink-0" />

      <main className="flex flex-1 items-center justify-center px-8 pb-[92px]">
        <div className="flex w-full max-w-xs flex-col items-center text-center">
          <ChiefMark className="h-10 w-10 text-foreground" />
          <h1 className="mt-12 font-serif text-3xl leading-tight">
            Sign in to Chief
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Your agents and data stay on this machine.
          </p>
          <Button
            className="mt-12 h-11 w-full"
            onClick={signIn}
            disabled={isSigningIn}
          >
            {isSigningIn ? "Waiting for your browser…" : "Sign in"}
          </Button>
          <p className="mt-3 h-4 text-xs text-muted-foreground/60">
            {isSigningIn
              ? "Finish signing in from the browser window."
              : "Sign-in opens in your browser."}
          </p>
          {authError ? (
            <p className="mt-4 border border-destructive/40 px-3 py-2 text-xs leading-relaxed text-destructive">
              {authError}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
