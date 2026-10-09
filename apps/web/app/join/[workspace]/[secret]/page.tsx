import Image from "next/image";
import Link from "next/link";

import { isWorkspaceId } from "../../../../lib/invitation-links";
import { publicRelayOrigin } from "../../../../lib/invitation-server";
import {
  expiryLabel,
  isInviteSecret,
  previewInvite,
  websiteIconUrl,
} from "../../../../lib/invite-link-server";
import {
  forwardedRelayHeaders,
  readRelayAccount,
} from "../../../../lib/sign-in-context";
import { JoinAccept } from "./join-accept";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ workspace: string; secret: string }>;
}) {
  const { workspace, secret } = await params;
  if (!isWorkspaceId(workspace) || !isInviteSecret(secret)) {
    return <JoinUnavailable code="" />;
  }
  const preview = await previewInvite(workspace, secret);
  if (preview.kind === "unreachable") return <JoinUnavailable unreachable />;
  if (preview.kind === "unavailable") {
    return <JoinUnavailable code={preview.code} />;
  }
  const account = await readRelayAccount(await forwardedRelayHeaders());
  if (account === undefined) return <JoinUnavailable unreachable />;

  const { invite } = preview;
  return (
    <JoinAccept
      account={account}
      channelName={invite.conversationName}
      expires={expiryLabel(invite.expiresAt)}
      icon={await websiteIconUrl(invite.website)}
      path={`/join/${workspace}/${secret}`}
      relay={publicRelayOrigin()}
      secret={secret}
      workspace={workspace}
      workspaceName={invite.workspaceName}
    />
  );
}

function JoinUnavailable({
  code = "",
  unreachable = false,
}: {
  code?: string;
  unreachable?: boolean;
}) {
  const reason = unreachable
    ? "Chief couldn’t reach this workspace. Try again in a moment."
    : code === "workspace_invite_expired"
      ? "This invitation has expired. Ask whoever invited you for a new link."
      : code === "workspace_invite_consumed"
        ? "This invitation has already been used. Ask whoever invited you for a new link."
        : code === "workspace_invite_revoked"
          ? "This invitation was revoked. Ask whoever invited you for a new link."
          : "This invitation isn’t valid. Ask whoever invited you for a new link.";
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
            Invite unavailable
          </h1>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
            {reason}
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
