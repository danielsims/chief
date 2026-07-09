"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConvexAuth } from "convex/react";

import { Button } from "@marketer/ui/components/button";

import { authClient } from "../../lib/auth-client";
import { GoogleLogo } from "./google-logo";

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Redirect away only when Convex has accepted our token — the same source
  // of truth the protected layouts use for their redirect to /sign-in. Using
  // the Better Auth session here instead caused an infinite redirect loop
  // whenever a session existed but a Convex token could not be minted.
  const { isAuthenticated, isLoading } = useConvexAuth();
  // Which provider button was clicked. Shows a spinner on that button until
  // the browser redirects (or the attempt fails). Ready for more providers.
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  // Get the callback URL from query params, default to home
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  // Desktop PKCE params — present when the desktop app opens this page
  const clientId = searchParams.get("client_id");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const state = searchParams.get("state");
  const isDesktopFlow = clientId === "marketer-desktop";

  // Redirect if already logged in (only for web flow)
  useEffect(() => {
    if (isAuthenticated && !isDesktopFlow) {
      router.replace(callbackUrl);
    }
  }, [isAuthenticated, router, callbackUrl, isDesktopFlow]);

  if (isAuthenticated && !isDesktopFlow) {
    return null;
  }

  const handleGoogleSignIn = async () => {
    if (loadingProvider) return;
    setLoadingProvider("google");

    if (isDesktopFlow && codeChallenge && state) {
      // Desktop PKCE flow: call signIn.social with PKCE params as query string
      // so the server after-hook can read them and store in the transfer cookie.
      // We construct the URL directly to ensure the PKCE params are in the query string.
      const successUrl = `/auth/success?redirectTo=${encodeURIComponent("marketer-desktop://")}`;

      const params = new URLSearchParams({
        client_id: clientId,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod ?? "S256",
        state,
      });

      const response = await fetch(
        `/api/auth/sign-in/social?${params.toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "google",
            callbackURL: successUrl,
          }),
          credentials: "include",
          redirect: "manual",
        },
      );

      // BetterAuth returns a redirect URL — follow it
      if (response.status === 200) {
        const data = (await response.json()) as {
          url?: string;
          redirect?: boolean;
        };
        if (data.url) {
          window.location.href = data.url;
          return;
        }
      }

      // Fallback: if response is a redirect, follow the Location header
      const location = response.headers.get("Location");
      if (location) {
        window.location.href = location;
        return;
      }

      console.error("[SignIn] Desktop PKCE flow failed:", response.status);
      setLoadingProvider(null);
    } else {
      // Standard web flow
      try {
        await authClient.signIn.social({
          provider: "google",
          callbackURL: callbackUrl,
        });
      } catch (error) {
        console.error("[SignIn] Google sign-in failed:", error);
        setLoadingProvider(null);
      }
    }
  };

  return (
    <main className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <header className="p-8">
        <span className="font-serif text-2xl italic leading-none select-none">
          m.
        </span>
      </header>

      <div className="flex flex-1 items-center justify-center px-8 pb-24">
        <div className="mx-auto flex w-full max-w-sm flex-col text-center">
          <h1 className="font-serif text-3xl leading-tight">
            {isDesktopFlow ? "Connect the desktop app" : "Sign in to Marketer"}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {isDesktopFlow
              ? "You'll be sent back to the app after signing in."
              : "Sign in to continue to your workspace."}
          </p>
          <Button
            className="mt-12 h-11 w-full"
            variant="outline"
            onClick={handleGoogleSignIn}
            disabled={isLoading || loadingProvider !== null}
          >
            {loadingProvider === "google" ? (
              <span
                aria-hidden
                className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : (
              <GoogleLogo className="mr-2 h-4 w-4" />
            )}
            {isLoading ? "Loading…" : "Continue with Google"}
          </Button>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground/60">
            Your data and agents stay on your machine.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <SignInContent />
    </Suspense>
  );
}
