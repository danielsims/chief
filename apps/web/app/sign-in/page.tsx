"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";

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
  const [authenticationMethods, setAuthenticationMethods] = useState<
    readonly AuthenticationMethod[] | null
  >(null);
  const [emailMode, setEmailMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Get the callback URL from query params, default to home
  const callbackUrl = safeLocalPath(searchParams.get("callbackUrl"));
  const isAddingAccount = searchParams.get("add") === "account";

  // Desktop PKCE params, present when the desktop app opens this page
  const clientId = searchParams.get("client_id");
  const isDesktopFlow = clientId === "chief-desktop";
  const isNativeOAuthFlow =
    (clientId === "chief-desktop" || clientId === "chief-mobile") &&
    Boolean(searchParams.get("sig"));
  const authorizationCallback = isNativeOAuthFlow
    ? nativeAuthorizationCallback(searchParams)
    : callbackUrl;

  // Native authorization can continue immediately. A normal browser visit
  // stays on this page so the relay session can be inspected or signed out.
  useEffect(() => {
    if (isAuthenticated && !isAddingAccount && isNativeOAuthFlow) {
      router.replace(authorizationCallback);
    }
  }, [
    authorizationCallback,
    isAuthenticated,
    isNativeOAuthFlow,
    router,
    isAddingAccount,
  ]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/.well-known/relay", {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseAuthenticationMethods(await response.json());
      })
      .then((methods) => {
        if (!cancelled) setAuthenticationMethods(methods);
      })
      .catch((caught: unknown) => {
        console.error("[SignIn] Could not read relay authentication:", caught);
        if (!cancelled) setAuthenticationMethods(["google"]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isAuthenticated && !isAddingAccount && isNativeOAuthFlow) {
    return null;
  }

  if (isAuthenticated && !isAddingAccount) {
    return (
      <main className="bg-background text-foreground flex min-h-screen w-full flex-col">
        <header className="px-6 pt-6">
          <Image
            alt="Chief"
            className="h-8 w-8"
            src="/brand/chief-mark-sharp-open-white.svg"
            width={32}
            height={32}
          />
        </header>
        <div className="flex flex-1 items-center justify-center px-8 pb-20">
          <div className="mx-auto flex w-full max-w-sm flex-col text-center">
            <h1 className="text-3xl leading-tight font-normal">
              Signed in to this relay
            </h1>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              {session?.user.email}
            </p>
            <Button
              className="mt-8 h-11 w-full"
              onClick={() => router.replace(callbackUrl)}
            >
              Continue
            </Button>
            <Button
              className="mt-3 h-11 w-full"
              variant="outline"
              onClick={() => void authClient.signOut()}
            >
              Sign out of this relay
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const handleGoogleSignIn = async () => {
    if (loadingProvider) return;
    setLoadingProvider("google");
    setError(null);

    try {
      // Native entry deliberately stops on this page. Only the user's explicit
      // provider click clears a previous browser session and opens Google's
      // account picker; arriving here must never simulate that click.
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: new URL(
          authorizationCallback,
          window.location.origin,
        ).toString(),
      });
      if (result.error) {
        setError(result.error.message ?? "Google sign-in is unavailable.");
        setLoadingProvider(null);
      }
    } catch (error) {
      console.error("[SignIn] Google sign-in failed:", error);
      setLoadingProvider(null);
      setError(
        error instanceof Error ? error.message : "Google sign-in failed.",
      );
    }
  };

  const handleEmailAuthentication = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (loadingProvider) return;
    setLoadingProvider("email-password");
    setError(null);
    try {
      const result =
        emailMode === "sign-up"
          ? await authClient.signUp.email({
              name: name.trim(),
              email: email.trim(),
              password,
              callbackURL: authorizationCallback,
            })
          : await authClient.signIn.email({
              email: email.trim(),
              password,
              callbackURL: authorizationCallback,
            });
      if (result.error) {
        setError(result.error.message ?? "Chief could not sign you in.");
        setLoadingProvider(null);
        return;
      }
      router.replace(authorizationCallback);
    } catch (caught) {
      console.error("[SignIn] Email authentication failed:", caught);
      setError(
        caught instanceof Error
          ? caught.message
          : "Chief could not sign you in.",
      );
      setLoadingProvider(null);
    }
  };

  return (
    <main className="bg-background text-foreground flex min-h-screen w-full flex-col">
      <header className="px-6 pt-6">
        <Image
          alt="Chief"
          className="h-8 w-8"
          src="/brand/chief-mark-sharp-open-white.svg"
          width={32}
          height={32}
        />
      </header>

      <div className="flex flex-1 items-center justify-center px-8 pb-20">
        <div className="mx-auto flex w-full max-w-sm flex-col text-center">
          <h1 className="text-3xl leading-tight font-normal">
            {isAddingAccount
              ? "Add another account"
              : isDesktopFlow
                ? "Connect the desktop app"
                : "Sign in to Chief"}
          </h1>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {isAddingAccount
              ? "Your current accounts will stay signed in."
              : isDesktopFlow
                ? "You'll be sent back to the app after signing in."
                : "Sign in to continue to your workspace."}
          </p>
          {authenticationMethods?.includes("email-password") ? (
            <form
              className="mt-8 flex flex-col gap-3 text-left"
              onSubmit={(event) => void handleEmailAuthentication(event)}
            >
              {emailMode === "sign-up" ? (
                <Input
                  aria-label="Name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Name"
                  required
                />
              ) : null}
              <Input
                aria-label="Email"
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                required
              />
              <Input
                aria-label="Password"
                autoComplete={
                  emailMode === "sign-up" ? "new-password" : "current-password"
                }
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                minLength={8}
                required
              />
              <Button
                className="h-11 w-full"
                disabled={isLoading || loadingProvider !== null}
                type="submit"
              >
                {loadingProvider === "email-password"
                  ? "Connecting…"
                  : emailMode === "sign-up"
                    ? "Create local account"
                    : "Sign in with email"}
              </Button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-center text-xs"
                disabled={loadingProvider !== null}
                onClick={() => {
                  setEmailMode((current) =>
                    current === "sign-in" ? "sign-up" : "sign-in",
                  );
                  setError(null);
                }}
              >
                {emailMode === "sign-up"
                  ? "Already have a local account? Sign in"
                  : "First time on this relay? Create an account"}
              </button>
            </form>
          ) : null}
          {authenticationMethods?.includes("google") ? (
            <Button
              className={
                authenticationMethods.includes("email-password")
                  ? "mt-3 h-11 w-full"
                  : "mt-8 h-11 w-full"
              }
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
          ) : null}
          {error ? (
            <p className="text-destructive mt-4 text-sm leading-5">{error}</p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

type AuthenticationMethod = "email-password" | "google";

const relayAuthenticationSchema = z.object({
  authentication: z.object({
    methods: z
      .array(z.enum(["email-password", "google"]))
      .optional()
      .default(["google"]),
  }),
});

function parseAuthenticationMethods(value: unknown): AuthenticationMethod[] {
  return relayAuthenticationSchema.parse(value).authentication.methods;
}

function safeLocalPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function nativeAuthorizationCallback(searchParams: URLSearchParams) {
  const authorizationParams = new URLSearchParams(searchParams);
  authorizationParams.delete("prompt");
  return `/api/auth/oauth2/authorize?${authorizationParams.toString()}`;
}

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="bg-background min-h-screen" />}>
      <SignInContent />
    </Suspense>
  );
}
