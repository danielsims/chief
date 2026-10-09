import type { ReactNode } from "react";
import { useState } from "react";
import { Check, Copy, Link2, Mail } from "lucide-react";
import { toast } from "sonner";

import type {
  WorkspaceInvitation,
  WorkspaceInviteLink,
} from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

import { RELAY_URL } from "../lib/config";
import { useRelaySession } from "../lib/relay-session";

/**
 * Owner/admin controls for inviting people by email or one-time link, and
 * resending or revoking what is still pending. A link's URL is shown once,
 * when it is created; the relay keeps only a hash.
 */
export function WorkspaceInvitationsCard({
  workspaceId,
  workspaceName,
  invitations,
  links,
  error,
  onChanged,
}: {
  workspaceId: string;
  workspaceName: string;
  invitations: readonly WorkspaceInvitation[];
  links: readonly WorkspaceInviteLink[];
  error?: string | null;
  onChanged: () => Promise<void>;
}) {
  const { client } = useRelaySession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [busyInvitation, setBusyInvitation] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Revocation | null>(null);
  const [mode, setMode] = useState<"email" | "link">("email");
  const [linkLabel, setLinkLabel] = useState("");
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const pending = invitations.filter(
    (invitation) => invitation.status === "pending",
  );

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!client || !address || busy) return;
    setBusy(true);
    try {
      await client.createWorkspaceInvitation({ email: address, role });
      toast.success(`Invitation sent to ${address}`);
      setEmail("");
      await onChanged();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Chief couldn’t send this invitation.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resend = async (invitation: WorkspaceInvitation) => {
    if (!client || busyInvitation) return;
    setBusyInvitation(invitation.id);
    try {
      await client.createWorkspaceInvitation({
        email: invitation.email,
        role: invitation.role === "admin" ? "admin" : "member",
        resend: true,
      });
      toast.success(`Invitation resent to ${invitation.email}`);
      await onChanged();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Chief couldn’t resend this invitation.",
      );
    } finally {
      setBusyInvitation(null);
    }
  };

  const createLink = async (event: React.FormEvent) => {
    event.preventDefault();
    const label = linkLabel.trim();
    if (!client || busy || !label) return;
    setBusy(true);
    try {
      const secret = generateInviteSecret();
      await client.createWorkspaceInvite({
        secret,
        expiresAt: inviteLinkExpiry(),
        label,
      });
      const url = new URL(
        `/invite/${workspaceId}/${secret}`,
        RELAY_URL,
      ).toString();
      await navigator.clipboard.writeText(url).catch(() => undefined);
      setCreatedLink(url);
      setLinkLabel("");
      await onChanged();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Chief couldn’t create an invite link.",
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (target: Revocation) => {
    if (!client) return;
    if (target.kind === "email") {
      await client.cancelWorkspaceInvitation(target.invitation.id);
    } else {
      await client.revokeWorkspaceInvite(target.link.inviteId);
    }
    await onChanged();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>Invite people to {workspaceName}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <nav
            aria-label="Invite method"
            className="flex items-center gap-5"
            role="tablist"
          >
            {(
              [
                ["email", "Email"],
                ["link", "Link"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-selected={mode === value}
                className={cn(
                  "text-muted-foreground hover:text-foreground relative flex h-8 items-center text-xs font-medium transition-colors",
                  mode === value && "text-foreground",
                )}
                key={value}
                onClick={() => setMode(value)}
                role="tab"
                type="button"
              >
                {label}
                {mode === value ? (
                  <span className="bg-foreground absolute right-0 bottom-0 left-0 h-px" />
                ) : null}
              </button>
            ))}
          </nav>
          {mode === "email" ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => void invite(event)}
            >
              <Input
                aria-label="Email"
                autoComplete="email"
                className="min-w-48 flex-1"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@company.com"
                type="email"
                value={email}
              />
              <Select
                onValueChange={(value) =>
                  setRole(value === "admin" ? "admin" : "member")
                }
                value={role}
              >
                <SelectTrigger aria-label="Role" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button disabled={busy || !email.trim()} type="submit">
                {busy ? "Sending…" : "Send invite"}
              </Button>
            </form>
          ) : (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => void createLink(event)}
            >
              <Input
                aria-label="Who is it for?"
                className="min-w-48 flex-1"
                maxLength={60}
                onChange={(event) => setLinkLabel(event.target.value)}
                placeholder="Who is it for?"
                required
                value={linkLabel}
              />
              <Button disabled={busy || !linkLabel.trim()} type="submit">
                {busy ? "Creating…" : "Create link"}
              </Button>
            </form>
          )}
        </div>

        {error ? <p className="text-destructive text-xs">{error}</p> : null}

        {pending.length > 0 || links.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs font-medium">
              Pending
            </h3>
            <ul className="divide-border border-border divide-y overflow-hidden rounded-xl border">
              {pending.map((invitation) => (
                <InvitationRow
                  icon={<Mail className="size-4" />}
                  key={invitation.id}
                  title={invitation.email}
                  detail={`${capitalize(invitation.role)} · Expires ${formatDate(invitation.expiresAt)}`}
                >
                  <Button
                    disabled={busyInvitation === invitation.id}
                    onClick={() => void resend(invitation)}
                    size="sm"
                    variant="secondary"
                  >
                    Resend
                  </Button>
                  <Button
                    onClick={() => setRevoking({ kind: "email", invitation })}
                    size="sm"
                    variant="ghost"
                  >
                    Revoke
                  </Button>
                </InvitationRow>
              ))}
              {links.map((link) => (
                <InvitationRow
                  icon={<Link2 className="size-4" />}
                  key={link.inviteId}
                  title={link.label ?? "Invite link"}
                  detail={`${link.conversationName ? `#${link.conversationName}` : "Link"} · Expires ${formatDate(link.expiresAt)}`}
                >
                  <Button
                    onClick={() => setRevoking({ kind: "link", link })}
                    size="sm"
                    variant="ghost"
                  >
                    Revoke
                  </Button>
                </InvitationRow>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>

      <RevokeDialog
        target={revoking}
        onClose={() => setRevoking(null)}
        onRevoke={revoke}
      />
      <InviteLinkDialog
        url={createdLink}
        onClose={() => setCreatedLink(null)}
      />
    </Card>
  );
}

type Revocation =
  | { kind: "email"; invitation: WorkspaceInvitation }
  | { kind: "link"; link: WorkspaceInviteLink };

function InvitationRow({
  icon,
  title,
  detail,
  children,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="flex min-w-0 items-center gap-3">
        <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm">{title}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {detail}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">{children}</span>
    </li>
  );
}

function RevokeDialog({
  target,
  onClose,
  onRevoke,
}: {
  target: Revocation | null;
  onClose: () => void;
  onRevoke: (target: Revocation) => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const close = () => {
    if (working) return;
    setFailure(null);
    onClose();
  };

  const confirm = async () => {
    if (!target) return;
    setWorking(true);
    setFailure(null);
    try {
      await onRevoke(target);
      onClose();
    } catch (cause) {
      setFailure(
        cause instanceof Error ? cause.message : "Chief couldn’t revoke this.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {target?.kind === "link"
              ? "Revoke this invite link?"
              : "Revoke this invitation?"}
          </DialogTitle>
          <DialogDescription className="leading-5">
            {target?.kind === "email"
              ? `${target.invitation.email} won’t be able to join with this invitation.`
              : "Nobody will be able to join with this link. It can’t be used again."}
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <p className="text-destructive text-xs leading-5">{failure}</p>
        ) : null}
        <DialogFooter>
          <Button disabled={working} onClick={close} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={working}
            onClick={() => void confirm()}
            variant="destructive"
          >
            {working ? "Revoking…" : "Revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shows a new invite link once. The relay keeps only its hash. */
function InviteLinkDialog({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  };

  const close = () => {
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={url !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite link ready</DialogTitle>
          <DialogDescription className="leading-5">
            It’s on your clipboard. Copy it now; you won’t see this link again.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted/40 flex w-full min-w-0 items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-xs select-all">
            {url}
          </code>
          <Button
            aria-label={copied ? "Copied" : "Copy invite link"}
            onClick={() => url && void copy(url)}
            size="sm"
            variant="ghost"
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={close}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "soon"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Invite links last seven days from the moment they are created. */
function inviteLinkExpiry(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
}

/** A fresh 43-character URL-safe secret, matching the relay's invite format. */
function generateInviteSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
