"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConvexAuth } from "convex/react";

import { Button } from "@chief/ui/components/button";

const MOBILE_RETURN_URL = "chief-mobile://auth";

function DeviceAuthorizationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);

  const userCode = searchParams.get("user_code");
  const returnTo = searchParams.get("return_to");
  const nativeReturnURL = returnTo === MOBILE_RETURN_URL ? returnTo : null;
  const currentURL = useMemo(() => {
    const params = new URLSearchParams();
    if (userCode) params.set("user_code", userCode);
    if (nativeReturnURL) params.set("return_to", nativeReturnURL);
    return `/device?${params.toString()}`;
  }, [nativeReturnURL, userCode]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(`/sign-in?callbackUrl=${encodeURIComponent(currentURL)}`);
    }
  }, [currentURL, isAuthenticated, isLoading, router]);

  const approve = useCallback(async () => {
    if (!userCode || approving || !isAuthenticated) return;
    setApproving(true);
    setError(null);

    try {
      const verification = await fetch(
        `/api/auth/device?user_code=${encodeURIComponent(userCode)}`,
        { credentials: "include" },
      );
      if (!verification.ok) throw new Error("Device code verification failed");

      const approval = await fetch("/api/auth/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userCode }),
      });
      if (!approval.ok) throw new Error("Device approval failed");

      if (nativeReturnURL) {
        window.location.assign(`${nativeReturnURL}?status=approved`);
      } else {
        setApproved(true);
        setApproving(false);
      }
    } catch (cause) {
      console.error("[Device authorization] Approval failed", cause);
      setError("Chief could not finish connecting this device.");
      setApproving(false);
    }
  }, [approving, isAuthenticated, nativeReturnURL, userCode]);

  useEffect(() => {
    if (isAuthenticated && userCode && !approving && !approved && !error) {
      // The auto-approve callback sets state; keep it off the synchronous
      // effect path so React does not cascade renders.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void approve();
    }
  }, [approve, approved, approving, error, isAuthenticated, userCode]);

  if (!userCode) {
    return (
      <DeviceError message="This sign-in request is missing its device code." />
    );
  }

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
        <div className="mx-auto flex w-full max-w-sm flex-col text-center">
          <h1 className="text-3xl leading-tight font-normal">
            {error
              ? "Chief could not connect"
              : approved
                ? "Chief is connected"
                : isLoading
                  ? "Loading Chief"
                  : "Connecting your account"}
          </h1>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {error ??
              (approved
                ? "You can close this window."
                : isLoading
                  ? "Checking your sign-in status…"
                  : "You’ll return to the app when this device is ready.")}
          </p>
          {error ? (
            <Button className="mt-10 h-11" variant="outline" onClick={approve}>
              Try again
            </Button>
          ) : !approved ? (
            <span
              aria-label="Connecting"
              className="mx-auto mt-10 h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function DeviceError({ message }: { message: string }) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-8">
      <div className="max-w-sm text-center">
        <h1 className="text-3xl font-normal">Chief could not connect</h1>
        <p className="text-muted-foreground mt-4 text-sm">{message}</p>
      </div>
    </main>
  );
}

export default function DeviceAuthorizationPage() {
  return (
    <Suspense fallback={<main className="bg-background min-h-screen" />}>
      <DeviceAuthorizationContent />
    </Suspense>
  );
}
