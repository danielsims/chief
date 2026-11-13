"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import {
  HandoffCard,
  HandoffHeading,
  HandoffNote,
  handoffPrimaryClassName,
  handoffSecondaryClassName,
  HandoffWorkspace,
} from "@chief/ui/components/handoff-card";

import type { SignInAccount } from "../../../../lib/sign-in-context";
import { authClient } from "../../../../lib/auth-client";
import { invitationDeepLink } from "../../../../lib/invitation-links";
import { ChiefBrand } from "../../../chief-brand";

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

  const tile = <WorkspaceTile icon={icon} name={workspaceName} />;
  return (
    <HandoffCard brand={<ChiefBrand />}>
      {accepted ? (
        <>
          <HandoffHeading done title="You’re in">
            You’ve joined {workspaceName}. Open Chief to start working with the
            team.
          </HandoffHeading>
          <HandoffWorkspace
            icon={tile}
            name={workspaceName}
            detail={channelName ? `#${channelName}` : undefined}
          />
          <button
            type="button"
            className={handoffPrimaryClassName}
            onClick={openChief}
          >
            Open in Chief
          </button>
          <Link className={handoffSecondaryClassName} href="/download">
            Don’t have Chief yet? Download it
          </Link>
        </>
      ) : (
        <>
          <HandoffHeading title="You’re invited">
            {account ? (
              <>
                Signed in as{" "}
                <span className="text-foreground">{account.email}</span>
              </>
            ) : (
              "Join the team and its agents on Chief."
            )}
          </HandoffHeading>
          <HandoffWorkspace
            icon={tile}
            name={workspaceName}
            detail={[channelName ? `#${channelName}` : null, expires]
              .filter(Boolean)
              .join(" · ")}
          />
          {account ? (
            <button
              type="button"
              className={handoffPrimaryClassName}
              disabled={working}
              onClick={() => void accept()}
            >
              {working ? "Joining…" : "Join workspace"}
            </button>
          ) : (
            <a className={handoffPrimaryClassName} href={signIn}>
              Sign in to join
            </a>
          )}
          {account ? (
            <button
              type="button"
              className={handoffSecondaryClassName}
              onClick={() => void switchAccount()}
            >
              Use a different account
            </button>
          ) : null}
          {error ? <HandoffNote tone="error">{error}</HandoffNote> : null}
        </>
      )}
    </HandoffCard>
  );
}

function WorkspaceTile({ icon, name }: { icon: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="bg-muted text-foreground relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[11px] text-base font-medium">
      {name.trim().charAt(0).toUpperCase()}
      {icon && !failed ? (
        <Image
          alt=""
          className="absolute inset-0 size-full object-cover"
          height={40}
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
          src={icon}
          unoptimized
          width={40}
        />
      ) : null}
    </span>
  );
}
