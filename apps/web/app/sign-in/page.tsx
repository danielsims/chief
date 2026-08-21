"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@chief/ui/components/button";

import { authClient } from "../../lib/auth-client";
import { GoogleLogo } from "./google-logo";

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: isLoading } = authClient.useSession();
  const isAuthenticated = Boolean(session?.user);
  // Which provider button was clicked. Shows a spinner on that button until
  // the browser redirects (or the attempt fails). Ready for more providers.
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  // Get the callback URL from query params, default to home
  const callbackUrl = safeLocalPath(searchParams.get("callbackUrl"));
  const shouldSwitchAccount = searchParams.get("switchAccount") === "1";

  // Desktop PKCE params, present when the desktop app opens this page
  const clientId = searchParams.get("client_id");
  const isDesktopFlow = clientId === "chief-desktop";
  const isNativeOAuthFlow =
    (clientId === "chief-desktop" || clientId === "chief-mobile") &&
    Boolean(searchParams.get("sig"));
  const authorizationCallback = isNativeOAuthFlow
    ? `/api/auth/oauth2/authorize?${searchParams.toString()}`
    : callbackUrl;

  // A signed-in user can continue immediately. Native flows return to the
  // relay's signed authorize request; ordinary web flows return locally.
  useEffect(() => {
    if (isAuthenticated && !shouldSwitchAccount) {
      router.replace(isNativeOAuthFlow ? authorizationCallback : callbackUrl);
    }
  }, [
    authorizationCallback,
    callbackUrl,
    isAuthenticated,
    isNativeOAuthFlow,
    router,
    shouldSwitchAccount,
  ]);

  if (isAuthenticated && !shouldSwitchAccount) {
    return null;
  }

  const handleGoogleSignIn = async () => {
    if (loadingProvider) return;
    setLoadingProvider("google");

    try {
      // Native entry deliberately stops on this page. Only the user's explicit
      // provider click clears a previous browser session and opens Google's
      // account picker; arriving here must never simulate that click.
      if (shouldSwitchAccount && isAuthenticated) {
        await authClient.signOut();
      }
      await authClient.signIn.social({
        provider: "google",
        callbackURL: new URL(
          authorizationCallback,
          window.location.origin,
        ).toString(),
      });
    } catch (error) {
      console.error("[SignIn] Google sign-in failed:", error);
      setLoadingProvider(null);
    }
  };

  return (
    <main className="bg-background text-foreground flex min-h-screen w-full flex-col">
      <header className="px-6 pt-6">
        <img
          alt="Chief"
          className="h-8 w-8"
          src="/brand/chief-mark-sharp-open-white.svg"
        />
      </header>

      <div className="flex flex-1 items-center justify-center px-8 pb-20">
        <div className="mx-auto flex w-full max-w-sm flex-col text-center">
          <h1 className="text-3xl leading-tight font-normal">
            {shouldSwitchAccount
              ? "Choose your account"
              : isDesktopFlow
                ? "Connect the desktop app"
                : "Sign in to Chief"}
          </h1>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {shouldSwitchAccount
              ? "Choose a sign-in option to continue to Chief."
              : isDesktopFlow
                ? "You'll be sent back to the app after signing in."
                : "Sign in to continue to your workspace."}
          </p>
          <Button
            className="mt-8 h-11 w-full"
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
            {isLoading ? "Loading…" : "Sign in with Google"}
          </Button>
        </div>
      </div>
    </main>
  );
}

function safeLocalPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="bg-background min-h-screen" />}>
      <SignInContent />
    </Suspense>
  );
}
