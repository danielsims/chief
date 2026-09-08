"use client";

import { Suspense, useEffect } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

import { SuccessCheck } from "@chief/ui/components/success-check";

const DEEP_LINK = "chief-desktop:///auth";

function desktopAuthDeepLink(search: URLSearchParams) {
  const params = new URLSearchParams();
  for (const key of ["code", "state", "iss", "error", "error_description"]) {
    const value = search.get(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${DEEP_LINK}?${query}` : DEEP_LINK;
}

function DesktopAuthContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const success = Boolean(
    searchParams.get("code") && searchParams.get("state"),
  );
  const deepLink = desktopAuthDeepLink(searchParams);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => {
      window.location.href = deepLink;
    }, 400);
    return () => window.clearTimeout(timer);
  }, [deepLink, success]);

  return (
    <main className="bg-background text-foreground flex min-h-screen w-full flex-col">
      <header className="p-8">
        <Image
          alt="Chief"
          className="h-8 w-8"
          src="/brand/chief-mark-sharp-open-white.svg"
          width={32}
          height={32}
        />
      </header>

      <div className="flex flex-1 items-center justify-center px-8 pb-24">
        <div className="mx-auto flex w-full max-w-xs flex-col items-center text-center">
          {success ? (
            <>
              <SuccessCheck className="mb-8" />
              <div className="success-copy flex w-full flex-col items-center">
                <h1 className="text-4xl leading-tight font-normal">
                  You&rsquo;re in.
                </h1>
                <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                  Chief is opening now. You can close this tab.
                </p>
                <a
                  href={deepLink}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 mt-12 inline-flex h-11 w-full items-center justify-center px-8 text-sm font-medium transition-colors"
                >
                  Open Chief
                </a>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-4xl leading-tight font-normal">
                Sign-in didn&rsquo;t finish.
              </h1>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                {error
                  ? "Return to Chief and try signing in again."
                  : "Chief didn\u2019t receive a complete sign-in response. Return to the app and try again."}
              </p>
              <a
                href={deepLink}
                className="hover:bg-accent mt-12 inline-flex h-11 w-full items-center justify-center border text-sm font-medium transition-colors"
              >
                Return to Chief
              </a>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function DesktopAuthPage() {
  return (
    <Suspense fallback={<main className="bg-background min-h-screen" />}>
      <DesktopAuthContent />
    </Suspense>
  );
}
