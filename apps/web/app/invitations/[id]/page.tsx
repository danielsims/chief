import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  isChannelId,
  isWorkspaceId,
  safeRelayOrigin,
} from "../../../lib/invitation-links";
import {
  publicRelayOrigin,
  readInvitationContext,
} from "../../../lib/invitation-server";
import { InvitationAccept } from "./invitation-accept";

export const dynamic = "force-dynamic";

const invitationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function safeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return trimmed.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed)
    ? trimmed
    : null;
}

export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const relay = safeRelayOrigin(first(search.relay));
  const workspace = first(search.workspace);
  const channel = first(search.channel);
  const invitedEmail = safeEmail(first(search.email));

  // An invitation is only ever accepted against the relay this deployment
  // fronts. A link carrying another relay's origin is not ours to act on.
  if (
    !invitationIdPattern.test(id) ||
    !relay ||
    relay !== publicRelayOrigin() ||
    !isWorkspaceId(workspace)
  ) {
    return <InvitationUnavailable />;
  }

  const callbackParams = new URLSearchParams({ relay, workspace });
  if (channel && isChannelId(channel)) callbackParams.set("channel", channel);
  if (invitedEmail) callbackParams.set("email", invitedEmail);
  const callbackUrl = `/invitations/${encodeURIComponent(id)}?${callbackParams.toString()}`;

  const context = await readInvitationContext(id);
  if (context.account === null) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  if (context.account === undefined) {
    return <InvitationUnavailable relayReachable={false} />;
  }

  return (
    <InvitationAccept
      invitationId={id}
      account={context.account}
      workspaceName={context.workspaceName}
      invitationEmail={context.invitationEmail}
      invitedEmail={invitedEmail}
      relay={relay}
      workspace={workspace}
      channel={channel && isChannelId(channel) ? channel : null}
      callbackUrl={callbackUrl}
    />
  );
}

function InvitationUnavailable({
  relayReachable = true,
}: {
  relayReachable?: boolean;
}) {
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
        <div className="mx-auto flex w-full max-w-sm flex-col text-center">
          <h1 className="text-3xl leading-tight font-normal">
            This invitation isn’t available.
          </h1>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {relayReachable
              ? "It may have expired, been cancelled, or belong to a different Chief relay. Ask the person who invited you for a new link."
              : "Chief couldn’t reach this workspace’s relay. Try again in a moment."}
          </p>
          <Link
            className="text-muted-foreground hover:text-foreground mt-8 text-sm"
            href="/"
          >
            Back to Chief
          </Link>
        </div>
      </div>
    </main>
  );
}
