import { RadioTower } from "lucide-react";

import { Button } from "@chief/ui/components/button";

import { RelayConnectionDialog } from "../components/relay-connection-control";
import {
  splashPrimaryButtonClass,
  SplashSurface,
} from "../components/splash-surface";
import { useAuth } from "../lib/auth/auth-context";

/** Full-window account sign-in. Relay connections are managed inside Chief. */
export function SignInScreen() {
  const { signIn, isSigningIn, authError } = useAuth();

  return (
    <SplashSurface
      chrome={
        <RelayConnectionDialog>
          <button
            type="button"
            aria-label="Connect a self-hosted relay"
            className="flex size-8 items-center justify-center rounded-[10px] text-white/70 transition-colors outline-none hover:bg-white/14 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <RadioTower size={14} />
          </button>
        </RelayConnectionDialog>
      }
    >
      <div className="splash-rise flex w-full flex-col items-center">
        <h1 className="mt-9 text-[2.125rem] leading-[1.1] font-normal tracking-[-0.03em] [text-shadow:0_1px_18px_rgba(16,12,28,0.35)]">
          Welcome to Chief
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-white/80 [text-shadow:0_1px_12px_rgba(16,12,28,0.45)]">
          The workspace for proactive AI agents.
        </p>
        <Button
          className={`mt-9 h-11 w-full rounded-xl text-[15px] ${splashPrimaryButtonClass}`}
          onClick={signIn}
          disabled={isSigningIn}
        >
          {isSigningIn ? "Waiting for your browser…" : "Sign in"}
        </Button>
        {authError ? (
          <p
            role="alert"
            className="mt-4 w-full rounded-xl bg-[#17121d]/55 px-3 py-2 text-xs leading-relaxed text-white shadow-[inset_0_0_0_1px_rgba(255,170,170,0.4)] backdrop-blur-md"
          >
            {authError}
          </p>
        ) : null}
      </div>
    </SplashSurface>
  );
}
