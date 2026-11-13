"use client";

import { useState } from "react";
import Image from "next/image";

import {
  HandoffCard,
  HandoffHeading,
  HandoffNote,
  handoffPrimaryClassName,
  handoffSecondaryClassName,
  HandoffWorkspace,
} from "@chief/ui/components/handoff-card";
import { cn } from "@chief/ui/lib/utils";

import type { SignInAccount, SignInWorkspace } from "../../lib/sign-in-context";
import { ChiefBrand } from "../chief-brand";

export function AccountChooser({
  account,
  error,
  onContinue,
  onSignOut,
  signOutLabel,
  signingOut,
  workspace,
}: {
  account: SignInAccount;
  error: string | null;
  onContinue: () => void;
  onSignOut: () => void;
  signOutLabel: string;
  signingOut: boolean;
  workspace: SignInWorkspace | null;
}) {
  return (
    <HandoffCard brand={<ChiefBrand />}>
      <HandoffHeading title="Welcome back">
        {workspace ? (
          <span className="inline-flex items-center gap-1.5">
            Continue to
            <Picture
              className="size-4 rounded-[4px] text-[9px]"
              image={workspace.image}
              name={workspace.name}
            />
            <span className="text-foreground">{workspace.name}</span>
          </span>
        ) : (
          "Continue to Chief with this account."
        )}
      </HandoffHeading>
      <HandoffWorkspace
        icon={
          <Picture
            className="size-10 rounded-full text-base"
            image={account.image}
            name={account.name}
          />
        }
        name={account.name}
        detail={account.name !== account.email ? account.email : undefined}
      />
      <button
        type="button"
        className={handoffPrimaryClassName}
        onClick={onContinue}
      >
        Continue as {account.name}
      </button>
      <button
        type="button"
        className={handoffSecondaryClassName}
        disabled={signingOut}
        onClick={onSignOut}
      >
        {signOutLabel}
      </button>
      {error ? <HandoffNote tone="error">{error}</HandoffNote> : null}
    </HandoffCard>
  );
}

/** An avatar or workspace icon that falls back to an initial if it can't load. */
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
      // Provider avatars and workspace logos come from arbitrary hosts.
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
