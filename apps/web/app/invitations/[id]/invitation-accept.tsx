"use client";

import { useEffect, useState } from "react";

import {
  HandoffCard,
  HandoffHeading,
  HandoffNote,
  handoffPrimaryClassName,
  handoffSecondaryClassName,
  HandoffWorkspace,
} from "@chief/ui/components/handoff-card";

import { authClient } from "../../../lib/auth-client";
import { invitationDeepLink } from "../../../lib/invitation-links";
import { ChiefBrand } from "../../chief-brand";

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

  const name = workspaceName ?? "This workspace";
  const tile = (
    <span
      aria-hidden
      className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-[11px] text-base font-medium"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
  return (
    <HandoffCard brand={<ChiefBrand />}>
      {accepted ? (
        <>
          <HandoffHeading done title="You’re in">
            Chief is opening now. You can close this tab.
          </HandoffHeading>
          <HandoffWorkspace icon={tile} name={name} detail={host} />
          <a href={deepLink} className={handoffPrimaryClassName}>
            Open Chief
          </a>
        </>
      ) : (
        <>
          <HandoffHeading title="You’re invited">
            Signed in as{" "}
            <span className="text-foreground">{account.email}</span>
          </HandoffHeading>
          <HandoffWorkspace
            icon={tile}
            name={name}
            detail={
              expectedEmail && !wrongAccount
                ? `Invitation for ${expectedEmail} · ${host}`
                : host
            }
          />
          {wrongAccount ? (
            <HandoffNote tone="error">
              This invitation was sent to{" "}
              <span className="font-medium">{expectedEmail}</span>. Sign in with
              that address to join.
            </HandoffNote>
          ) : null}
          <button
            type="button"
            className={handoffPrimaryClassName}
            disabled={working || wrongAccount}
            onClick={() => void accept()}
          >
            {working ? "Joining…" : "Join workspace"}
          </button>
          <button
            type="button"
            className={handoffSecondaryClassName}
            disabled={signingOut}
            onClick={() => void switchAccount()}
          >
            {signingOut ? "Signing out…" : "Use a different account"}
          </button>
          {error ? <HandoffNote tone="error">{error}</HandoffNote> : null}
        </>
      )}
    </HandoffCard>
  );
}
