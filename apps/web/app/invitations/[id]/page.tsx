"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@chief/ui/components/button";

import { authClient } from "../../../lib/auth-client";

export default function InvitationPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const session = authClient.useSession();
  const [working, setWorking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const relay = search.get("relay") ?? "";
  const workspace = search.get("workspace") ?? "";
  const safeRelay = useMemo(() => {
    try {
      const url = new URL(relay);
      const local =
        url.hostname === "localhost" || url.hostname === "127.0.0.1";
      return !url.username &&
        !url.password &&
        (url.protocol === "https:" || (local && url.protocol === "http:"))
        ? url.origin
        : null;
    } catch {
      return null;
    }
  }, [relay]);

  useEffect(() => {
    if (session.isPending || session.data || !safeRelay) return;
    const callbackUrl = `/invitations/${encodeURIComponent(params.id)}?${search.toString()}`;
    router.replace(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }, [params.id, router, safeRelay, search, session.data, session.isPending]);

  const accept = async () => {
    if (!safeRelay || !workspace || working) return;
    setWorking(true);
    setError(null);
    const result = await authClient.organization.acceptInvitation({
      invitationId: params.id,
    });
    if (result.error) {
      setError(
        result.error.message ?? "Chief couldn’t accept this invitation.",
      );
      setWorking(false);
      return;
    }
    setAccepted(true);
    setWorking(false);
  };

  const query = new URLSearchParams({ relay: safeRelay ?? "", workspace });
  const mobile = `chief-mobile://organization-invite?${query}`;
  const desktop = `chief-desktop://organization-invite?${query}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080808] px-5 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111] p-8">
        <p className="text-sm text-white/50">Chief invitation</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">
          {accepted ? "You’re in" : "Join this workspace?"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-white/60">
          {accepted
            ? "Open Chief to finish adding the workspace to this device."
            : "Your account will join this workspace. Check the relay before continuing."}
        </p>
        <p className="mt-6 truncate rounded-xl bg-white/5 px-3 py-3 font-mono text-xs text-white/70">
          {safeRelay ? new URL(safeRelay).host : "Invalid relay"}
        </p>
        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
        {accepted ? (
          <div className="mt-7 space-y-2">
            <Button render={<a href={mobile} />} className="w-full">
              Open Chief
            </Button>
            <Button
              render={<a href={desktop} />}
              variant="secondary"
              className="w-full"
            >
              Open Chief for desktop
            </Button>
          </div>
        ) : (
          <Button
            className="mt-7 w-full"
            disabled={!session.data || !safeRelay || !workspace || working}
            onClick={() => void accept()}
          >
            {working ? "Joining…" : "Join workspace"}
          </Button>
        )}
      </section>
    </main>
  );
}
