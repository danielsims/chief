"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function SuccessContent() {
  const searchParams = useSearchParams();
  const redirectBase = searchParams.get("redirectTo");
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"polling" | "ready" | "timeout">(
    "polling",
  );

  useEffect(() => {
    if (!redirectBase) return;

    // Desktop PKCE flow: poll for the authorization code cookie
    if (redirectBase.startsWith("marketer-desktop://")) {
      const cookieName = "better-auth.marketer-desktop";
      const startTime = Date.now();
      const TIMEOUT = 10_000; // 10 seconds
      const INTERVAL = 100; // 100ms

      const pollTimer = setInterval(() => {
        // Check timeout
        if (Date.now() - startTime > TIMEOUT) {
          clearInterval(pollTimer);
          setStatus("timeout");
          return;
        }

        // Look for the authorization code cookie
        const cookies = document.cookie.split(";");
        for (const cookie of cookies) {
          const trimmed = cookie.trim();
          if (trimmed.startsWith(`${cookieName}=`)) {
            const authorizationCode = trimmed.substring(cookieName.length + 1);

            if (authorizationCode) {
              clearInterval(pollTimer);

              // Clear the cookie
              document.cookie = `${cookieName}=; path=/; max-age=0`;

              // Redirect to the deep link with the authorization code.
              // Keep the hash token for older macOS builds, and include the
              // query token because Windows protocol activation can drop URL
              // fragments before the desktop app receives the link.
              const encodedCode = encodeURIComponent(authorizationCode);
              const url = `marketer-desktop:///auth?token=${encodedCode}#token=${encodedCode}`;
              setDeepLinkUrl(url);
              setStatus("ready");

              void publishDesktopPkceToken(authorizationCode);

              setTimeout(() => {
                window.location.href = url;
              }, 500);
            }
            break;
          }
        }
      }, INTERVAL);

      return () => clearInterval(pollTimer);
    }

    // Regular web redirect
    const timer = setTimeout(() => {
      setDeepLinkUrl(redirectBase);
      window.location.href = redirectBase;
    }, 800);
    return () => clearTimeout(timer);
  }, [redirectBase]);

  return (
    <main className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <header className="p-8">
        <span className="font-serif text-2xl italic leading-none select-none">
          m.
        </span>
      </header>

      <div className="flex flex-1 items-center justify-center px-8 pb-24">
        <div className="mx-auto flex w-full max-w-xs flex-col items-center text-center">
          <h1 className="font-serif text-3xl leading-tight">
            {status === "polling"
              ? "Signing you in…"
              : status === "timeout"
                ? "Sign-in timed out"
                : "Signed in"}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {status === "polling"
              ? "Returning you to the app."
              : status === "timeout"
                ? "Close this tab and try again from the desktop app."
                : "You can close this tab once the app opens."}
          </p>
          {deepLinkUrl ? (
            <a
              href={deepLinkUrl}
              className="mt-12 inline-flex h-11 w-full items-center justify-center bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open Marketer
            </a>
          ) : null}
        </div>
      </div>
    </main>
  );
}

async function publishDesktopPkceToken(redirectToken: string) {
  try {
    const decoded = decodeBase64Url(redirectToken);
    const tokenData = JSON.parse(decoded) as { state?: string };
    if (!tokenData.state) return;

    await fetch("/api/desktop-auth/pkce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state: tokenData.state,
        redirectToken,
      }),
      keepalive: true,
    });
  } catch {
    // Non-fatal: deep link remains the primary path.
  }
}

function decodeBase64Url(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return atob(base64);
}

export default function AuthSuccessPage() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-background" />}
    >
      <SuccessContent />
    </Suspense>
  );
}
