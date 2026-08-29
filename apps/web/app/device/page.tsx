"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@chief/ui/components/button";

import { authClient } from "../../lib/auth-client";

const MOBILE_RETURN_URL = "chief-mobile://auth";

function DeviceAuthorizationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: isLoading } = authClient.useSession();
  const isAuthenticated = Boolean(session?.user);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [requestReady, setRequestReady] = useState(false);

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

  useEffect(() => {
    if (!userCode || !isAuthenticated) return;
    let cancelled = false;
    void fetch(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`, {
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) throw new Error("Device code verification failed");
        if (!cancelled) setRequestReady(true);
      })
      .catch((cause: unknown) => {
        console.error("[Device authorization] Verification failed", cause);
        if (!cancelled) {
          setError("This device request is invalid or has expired.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userCode]);

  const approve = useCallback(async () => {
    if (!userCode || approving || !isAuthenticated || !requestReady) return;
    setApproving(true);
    setError(null);

    try {
      const approval = await fetch("/api/auth/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userCode }),
      });
      if (!approval.ok) throw new Error("Device approval failed");

      setApproved(true);
      setApproving(false);
      if (nativeReturnURL) {
        window.setTimeout(() => {
          window.location.assign(`${nativeReturnURL}?status=approved`);
        }, 300);
      }
    } catch (cause) {
      console.error("[Device authorization] Approval failed", cause);
      setError("Chief could not finish connecting this device.");
      setApproving(false);
    }
  }, [approving, isAuthenticated, nativeReturnURL, requestReady, userCode]);

  const deny = useCallback(async () => {
    if (!userCode || approving || !isAuthenticated || !requestReady) return;
    setApproving(true);
    try {
      await fetch("/api/auth/device/deny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userCode }),
      });
    } finally {
      if (nativeReturnURL) {
        window.location.assign(`${nativeReturnURL}?status=denied`);
      } else {
        router.replace("/");
      }
    }
  }, [
    approving,
    isAuthenticated,
    nativeReturnURL,
    requestReady,
    router,
    userCode,
  ]);

  if (!userCode) {
    return (
      <DeviceError message="This sign-in request is missing its device code." />
    );
  }

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
        <div className="mx-auto flex w-full max-w-sm flex-col text-center">
          <h1 className="text-3xl leading-tight font-normal">
            {error
              ? "Chief could not connect"
              : approved
                ? nativeReturnURL
                  ? "Returning to Chief"
                  : "Chief is connected"
                : isLoading
                  ? "Loading Chief"
                  : !isAuthenticated
                    ? "Opening sign in"
                    : requestReady
                      ? "Connect this device"
                      : "Checking this device"}
          </h1>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {error ??
              (approved
                ? nativeReturnURL
                  ? "Your account is connected."
                  : "You can close this window."
                : isLoading
                  ? "Checking your sign-in status…"
                  : !isAuthenticated
                    ? "Continue in the secure sign-in page."
                    : requestReady
                      ? "Only continue if you started this request on your device."
                      : "Verifying the request…")}
          </p>
          {error ? (
            <Button
              className="mt-10 h-11"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Try again
            </Button>
          ) : requestReady && !approved ? (
            <div className="mt-10 flex flex-col gap-3">
              <Button onClick={approve} disabled={approving}>
                {approving ? "Connecting…" : "Connect device"}
              </Button>
              <Button variant="ghost" onClick={deny} disabled={approving}>
                Cancel
              </Button>
            </div>
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
