"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

import {
  HandoffCard,
  HandoffHeading,
  handoffPrimaryClassName,
} from "@chief/ui/components/handoff-card";

import { ChiefBrand } from "../../chief-brand";

const DEEP_LINK = "chief-desktop:///billing/success";

function BillingReturnContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get("status") === "success";
  const sessionId = searchParams.get("session_id");
  const deepLink = sessionId
    ? `${DEEP_LINK}?session_id=${encodeURIComponent(sessionId)}`
    : DEEP_LINK;

  // Hand the moment back to the app, the same way sign-in returns through the
  // desktop deep link. The button stays as the manual path if the browser
  // blocks the protocol handoff.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => {
      window.location.href = deepLink;
    }, 1800);
    return () => clearTimeout(timer);
  }, [deepLink, success]);

  return (
    <HandoffCard brand={<ChiefBrand />}>
      {success ? (
        <HandoffHeading done title={<>You&rsquo;re in</>}>
          Your workspace is ready. Chief is opening now. You can close this tab.
        </HandoffHeading>
      ) : (
        <HandoffHeading title="Checkout canceled">
          Nothing was charged. Return to Chief when you&rsquo;re ready.
        </HandoffHeading>
      )}
      <a href={deepLink} className={handoffPrimaryClassName}>
        {success ? "Open Chief" : "Return to Chief"}
      </a>
    </HandoffCard>
  );
}

export default function BillingReturnPage() {
  return (
    <Suspense fallback={<main className="bg-background min-h-screen" />}>
      <BillingReturnContent />
    </Suspense>
  );
}
