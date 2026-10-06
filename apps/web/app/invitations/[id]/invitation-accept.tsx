"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { Button, buttonVariants } from "@chief/ui/components/button";
import { SuccessCheck } from "@chief/ui/components/success-check";
import { cn } from "@chief/ui/lib/utils";

import { authClient } from "../../../lib/auth-client";
import { invitationDeepLink } from "../../../lib/invitation-links";

export interface InvitationAccount {
  name: string;
  email: string;
  image: string | null;
}

export function InvitationAccept({
  invitationId,
  account,
  workspaceName,
  invitationEmail,
  invitedEmail,
  relay,
  workspace,
  channel,
  callbackUrl,
}: {
  invitationId: string;
  account: InvitationAccount;
  workspaceName: string | null;
  invitationEmail: string | null;
  invitedEmail: string | null;
  relay: string;
  workspace: string;
  channel: string | null;
  callbackUrl: string;
}) {
  const [working, setWorking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectedEmail =
    (invitationEmail ?? invitedEmail)?.trim().toLowerCase() ?? null;
  const wrongAccount =
    expectedEmail !== null && expectedEmail !== account.email.toLowerCase();

  const deepLink = invitationDeepLink("chief-desktop", {
    relay,
    workspace,
    channel,
  });

  useEffect(() => {
    if (!accepted) return;
    const timer = window.setTimeout(() => {
      window.location.href = deepLink;
    }, 500);
    return () => window.clearTimeout(timer);
  }, [accepted, deepLink]);

  const accept = async () => {
    if (working || wrongAccount) return;
    setWorking(true);
    setError(null);
    const result = await authClient.organization.acceptInvitation({
      invitationId,
    });
    setWorking(false);
    if (result.error) {
      const message = result.error.message ?? "";
      setError(
        /recipient/iu.test(message)
          ? "This invitation was sent to a different email address. Use the account that received it."
          : message || "Chief couldn’t accept this invitation.",
      );
      return;
    }
    setAccepted(true);
  };

  const switchAccount = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await authClient.signOut();
    } catch (caught) {
      console.error("[Invitation] Sign out failed:", caught);
    }
    window.location.assign(
      `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    );
  };

  let host = relay;
  try {
    host = new URL(relay).host;
  } catch {
    // The server already validated the relay; keep the raw value as a fallback.
  }

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
                Chief is opening now. You can close this tab.
              </p>
              <a
                href={deepLink}
                className={cn(buttonVariants(), "mt-8 h-11 w-full")}
              >
                Open Chief
              </a>
            </>
          ) : (
            <>
              <Picture
                className="h-16 w-16 rounded-full text-2xl"
                image={account.image}
                name={account.name}
              />
              <h1 className="mt-6 text-3xl leading-tight font-normal">
                {workspaceName
                  ? `Join ${workspaceName}?`
                  : "Join this workspace?"}
              </h1>
              <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                You’re signed in as{" "}
                <span className="text-foreground font-medium">
                  {account.email}
                </span>
                .
              </p>
              {expectedEmail && !wrongAccount ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  Invitation for {expectedEmail} · {host}
                </p>
              ) : null}
              {wrongAccount ? (
                <p className="text-destructive mt-4 text-sm leading-5">
                  This invitation was sent to{" "}
                  <span className="font-medium">{expectedEmail}</span>, but
                  you’re signed in as {account.email}. Sign in with the invited
                  address.
                </p>
              ) : null}
              <Button
                className="mt-8 h-11 w-full"
                disabled={working || wrongAccount}
                onClick={() => void accept()}
              >
                {working ? "Joining…" : "Join workspace"}
              </Button>
              <Button
                className="text-muted-foreground hover:text-foreground mt-2 h-11 w-full"
                disabled={signingOut}
                onClick={() => void switchAccount()}
                variant="ghost"
              >
                {signingOut ? "Signing out…" : "Use a different account"}
              </Button>
              {error ? (
                <p className="text-destructive mt-4 text-sm leading-5">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Picture({
  className,
  image,
  name,
}: {
  className: string;
  image: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    return (
      <Image
        alt=""
        className={cn("object-cover", className)}
        height={64}
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        src={image}
        unoptimized
        width={64}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "bg-muted text-foreground flex shrink-0 items-center justify-center",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
