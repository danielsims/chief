"use client";

import { useState } from "react";
import Image from "next/image";

import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { SignInAccount, SignInWorkspace } from "../../lib/sign-in-context";

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
    <main className="bg-background text-foreground flex min-h-screen w-full flex-col">
      <header className="px-6 pt-6">
        <Image
          alt="Chief"
          className="h-8 w-8"
          src="/brand/chief-mark-sharp-open-white.svg"
          width={32}
          height={32}
        />
      </header>
      <div className="flex flex-1 items-center justify-center px-8 pb-20">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
          <Picture
            className="h-16 w-16 rounded-full text-2xl"
            image={account.image}
            name={account.name}
          />
          <h1 className="mt-6 text-3xl leading-tight font-normal">
            {account.name}
          </h1>
          {account.name !== account.email ? (
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {account.email}
            </p>
          ) : null}
          {workspace ? (
            <p className="text-muted-foreground mt-6 inline-flex items-center gap-2 text-sm">
              Continue to
              <Picture
                className="h-5 w-5 rounded-[5px] text-[11px]"
                image={workspace.image}
                name={workspace.name}
              />
              <span className="text-foreground">{workspace.name}</span>
            </p>
          ) : null}
          <Button className="mt-8 h-11 w-full" onClick={onContinue}>
            Continue as {account.name}
          </Button>
          <Button
            className="text-muted-foreground hover:text-foreground mt-2 h-11 w-full"
            disabled={signingOut}
            onClick={onSignOut}
            variant="ghost"
          >
            {signOutLabel}
          </Button>
          {error ? (
            <p className="text-destructive mt-4 text-sm leading-5">{error}</p>
          ) : null}
        </div>
      </div>
    </main>
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
