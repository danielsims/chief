"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { SuccessCheck } from "@chief/ui/components/success-check";

const DEEP_LINK = "chief-desktop:///billing/success";

function BillingReturnContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get("status") === "success";
  const sessionId = searchParams.get("session_id");
  const deepLink = sessionId
    ? `${DEEP_LINK}?session_id=${encodeURIComponent(sessionId)}`
    : DEEP_LINK;

  // Hand the moment back to the app once the check has landed, the same way
  // sign-in returns through the desktop deep link. The button stays as the
  // manual path if the browser blocks the protocol handoff.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => {
      window.location.href = deepLink;
    }, 1800);
    return () => clearTimeout(timer);
  }, [deepLink, success]);

  return (
    <main className="bg-background text-foreground flex min-h-screen w-full flex-col">
      <header className="p-8">
        <img
          alt="Chief"
          className="h-8 w-8"
          src="/brand/chief-mark-sharp-open-white.svg"
        />
      </header>

      <div className="flex flex-1 items-center justify-center px-8 pb-24">
        <div className="mx-auto flex w-full max-w-xs flex-col items-center text-center">
          {success ? (
            <>
              <SuccessCheck className="mb-8" />
              <div className="success-copy flex w-full flex-col items-center">
                <h1 className="font-serif text-4xl leading-tight">
                  You&rsquo;re in.
                </h1>
                <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                  Your workspace is ready. Chief is opening now. You can close
                  this tab.
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
              <h1 className="font-serif text-4xl leading-tight">
                Checkout canceled.
              </h1>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                Nothing was charged. Return to Chief when you&rsquo;re ready.
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

export default function BillingReturnPage() {
  return (
    <Suspense fallback={<main className="bg-background min-h-screen" />}>
      <BillingReturnContent />
    </Suspense>
  );
}
