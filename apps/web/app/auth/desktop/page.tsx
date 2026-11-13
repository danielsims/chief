"use client";

import { Suspense, useEffect } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

import { DesktopAuthResult } from "@chief/ui/components/desktop-auth-result";

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
    <DesktopAuthResult
      success={success}
      error={Boolean(error)}
      returnHref={deepLink}
      brand={
        <Image
          alt="Chief"
          className="h-8 w-8"
          src="/brand/chief-mark-white.svg"
          width={32}
          height={32}
        />
      }
    />
  );
}

export default function DesktopAuthPage() {
  return (
    <Suspense fallback={<main className="bg-background min-h-screen" />}>
      <DesktopAuthContent />
    </Suspense>
  );
}
