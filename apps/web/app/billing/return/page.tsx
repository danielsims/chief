"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { SuccessCheck } from "@marketer/ui/components/success-check";

const DEEP_LINK = "marketer-desktop:///billing/success";

function BillingReturnContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get("status") === "success";

  // Hand the moment back to the app once the check has landed, the same way
  // sign-in returns through the desktop deep link. The button stays as the
  // manual path if the browser blocks the protocol handoff.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => {
      window.location.href = DEEP_LINK;
    }, 1800);
    return () => clearTimeout(timer);
  }, [success]);

  return (
    <main className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <header className="p-8">
        <span className="font-serif text-2xl italic leading-none select-none">
          m.
        </span>
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
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Your workspace is ready. Marketer is opening now. You can
                  close this tab.
                </p>
                <a
                  href={DEEP_LINK}
                  className="mt-12 inline-flex h-11 w-full items-center justify-center bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Open Marketer
                </a>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-serif text-4xl leading-tight">
                Checkout canceled.
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Nothing was charged. Return to Marketer when you&rsquo;re
                ready.
              </p>
              <a
                href={DEEP_LINK}
                className="mt-12 inline-flex h-11 w-full items-center justify-center border text-sm font-medium transition-colors hover:bg-accent"
              >
                Return to Marketer
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
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <BillingReturnContent />
    </Suspense>
  );
}
