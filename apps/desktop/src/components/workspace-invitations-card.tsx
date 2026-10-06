import { useState } from "react";
import { toast } from "sonner";

import type { WorkspaceInvitation } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chief/ui/components/select";

import { RELAY_URL } from "../lib/config";
import { useRelaySession } from "../lib/relay-session";

/**
 * Owner/admin controls for inviting people by email, resending or cancelling
 * pending invitations, and copying a shareable invite link.
 */
export function WorkspaceInvitationsCard({
  workspaceId,
  workspaceName,
  invitations,
  error,
  onChanged,
}: {
  workspaceId: string;
  workspaceName: string;
  invitations: readonly WorkspaceInvitation[];
  error?: string | null;
  onChanged: () => Promise<void>;
}) {
  const { client } = useRelaySession();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [busyInvitation, setBusyInvitation] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const cancel = async (invitation: WorkspaceInvitation) => {
    if (!client || busyInvitation) return;
    setBusyInvitation(invitation.id);
    try {
      await client.cancelWorkspaceInvitation(invitation.id);
      await onChanged();
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Chief couldn’t cancel this invitation.",
      );
    } finally {
      setBusyInvitation(null);
    }
  };

  const copyInviteLink = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const secret = generateInviteSecret();
      await client.createWorkspaceInvite({
        secret,
        expiresAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
      });
      const url = new URL(
        `/invite/${workspaceId}/${secret}`,
        RELAY_URL,
      ).toString();
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied");
      window.setTimeout(() => setCopied(false), 2_000);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>
          Invite people to {workspaceName}. They receive an email and join once
          they accept it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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

        {error ? <p className="text-destructive text-xs">{error}</p> : null}

        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium">
            Pending invitations
          </h3>
          {pending.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No pending invitations.
            </p>
          ) : (
            <ul className="divide-border border-border divide-y overflow-hidden rounded-xl border">
              {pending.map((invitation) => (
                <li
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                  key={invitation.id}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {invitation.email}
                    </span>
                    <span className="text-muted-foreground text-xs capitalize">
                      {invitation.role} · expires{" "}
                      {formatDate(invitation.expiresAt)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      disabled={busyInvitation === invitation.id}
                      onClick={() => void resend(invitation)}
                      size="sm"
                      variant="secondary"
                    >
                      Resend
                    </Button>
                    <Button
                      disabled={busyInvitation === invitation.id}
                      onClick={() => void cancel(invitation)}
                      size="sm"
                      variant="ghost"
                    >
                      Cancel
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="border-border flex items-center justify-between gap-3 border-t pt-4">
          <p className="text-muted-foreground text-xs">
            Need a link instead of an email? Share one that expires in 7 days.
          </p>
          <Button
            disabled={busy}
            onClick={() => void copyInviteLink()}
            size="sm"
            variant="secondary"
          >
            {copied ? "Copied" : "Copy invite link"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "soon"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A fresh 43-character URL-safe secret, matching the relay's invite format. */
function generateInviteSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
