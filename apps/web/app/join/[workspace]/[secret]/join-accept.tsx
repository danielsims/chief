"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { Button, buttonVariants } from "@chief/ui/components/button";
import { SuccessCheck } from "@chief/ui/components/success-check";
import { cn } from "@chief/ui/lib/utils";

import type { SignInAccount } from "../../../../lib/sign-in-context";
import { authClient } from "../../../../lib/auth-client";
import { invitationDeepLink } from "../../../../lib/invitation-links";

export function JoinAccept({
  account,
  channelName,
  expires,
  icon,
  path,
  relay,
  secret,
  workspace,
  workspaceName,
}: {
  account: SignInAccount | null;
  channelName: string | null;
  expires: string;
  icon: string | null;
  path: string;
  relay: string;
  secret: string;
  workspace: string;
  workspaceName: string;
}) {
  const [working, setWorking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = `/sign-in?callbackUrl=${encodeURIComponent(path)}`;

  const accept = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace, secret }),
      });
      if (response.status === 401) {
        window.location.assign(signIn);
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 410
            ? "This invitation is no longer available. Ask whoever invited you for a new link."
            : "Chief couldn’t accept this invitation. Try again.",
        );
        return;
      }
      setAccepted(true);
    } catch {
      setError("Chief couldn’t accept this invitation. Try again.");
    } finally {
      setWorking(false);
    }
  };

  const switchAccount = async () => {
    await authClient.signOut().catch(() => undefined);
    window.location.assign(signIn);
  };

  const openChief = () => {
    const mobile = /iPhone|iPad|iPod|Android/iu.test(navigator.userAgent);
    window.location.href = invitationDeepLink(
      mobile ? "chief-mobile" : "chief-desktop",
      { relay, workspace },
    );
  };

  return (
    <main className="bg-background text-foreground flex min-h-screen w-full flex-col">
      <header className="px-6 pt-6">
        <Image
          alt="Chief"
          className="h-8 w-8"
          src="/brand/chief-mark-white.svg"
          width={32}
          height={32}
        />
      </header>
      <div className="flex flex-1 items-center justify-center px-8 pb-20">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
          {accepted ? (
            <>
              <SuccessCheck className="mb-6 size-16" />
              <h1 className="text-3xl leading-tight font-normal">You’re in.</h1>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                You’ve joined {workspaceName}.
              </p>
              <Button className="mt-8 h-11 w-full" onClick={openChief}>
                Open in Chief
              </Button>
              <Link
                className="text-muted-foreground hover:text-foreground mt-6 text-xs"
                href="/download"
              >
                Don’t have Chief yet? Download it
              </Link>
            </>
          ) : (
            <>
              <WorkspaceTile icon={icon} name={workspaceName} />
              <h1 className="mt-6 text-3xl leading-tight font-normal">
                Join {workspaceName}
              </h1>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                {account ? (
                  <>
                    Signed in as{" "}
                    <span className="text-foreground">{account.email}</span>
                  </>
                ) : channelName ? (
                  `You’ve been invited to #${channelName} on Chief.`
                ) : (
                  "You’ve been invited to collaborate on Chief."
                )}
              </p>
              {account ? (
                <Button
                  className="mt-8 h-11 w-full"
                  disabled={working}
                  onClick={() => void accept()}
                >
                  {working ? "Joining…" : "Join workspace"}
                </Button>
              ) : (
                <a
                  className={cn(buttonVariants(), "mt-8 h-11 w-full")}
                  href={signIn}
                >
                  Sign in to join
                </a>
              )}
              {error ? (
                <p className="text-destructive mt-4 text-sm leading-5">
                  {error}
                </p>
              ) : null}
              <p className="text-muted-foreground mt-6 text-xs">
                {expires}
                {account ? (
                  <>
                    {" · "}
                    <button
                      className="hover:text-foreground"
                      onClick={() => void switchAccount()}
                      type="button"
                    >
                      Use a different account
                    </button>
                  </>
                ) : null}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function WorkspaceTile({ icon, name }: { icon: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="bg-muted text-foreground relative flex size-16 items-center justify-center overflow-hidden rounded-[18px] text-2xl">
      {name.trim().charAt(0).toUpperCase()}
      {icon && !failed ? (
        <Image
          alt=""
          className="absolute inset-0 size-full object-cover"
          height={64}
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
          src={icon}
          unoptimized
          width={64}
        />
      ) : null}
    </span>
  );
}
