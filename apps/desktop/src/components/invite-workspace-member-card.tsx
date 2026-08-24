import { useState } from "react";

import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { Input } from "@chief/ui/components/input";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { inviteAuthOrganizationMember } from "../lib/auth/organization-invitations";

export function InviteWorkspaceMemberCard({
  organization,
}: {
  organization: AuthOrganization;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address || sending) return;
    setSending(true);
    setStatus("idle");
    setError(null);
    try {
      await inviteAuthOrganizationMember({
        email: address,
        organizationId: organization.id,
      });
      setStatus("sent");
    } catch (caught) {
      setStatus("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Chief couldn’t send this invitation.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite a teammate</CardTitle>
        <CardDescription>
          They’ll receive a secure invitation to {organization.name} and must
          sign in with the invited email address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void send(event)} className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setStatus("idle");
              setError(null);
            }}
            placeholder="teammate@company.com"
            autoCapitalize="none"
            autoComplete="email"
            required
          />
          <Button type="submit" disabled={sending || !email.trim()}>
            {sending ? "Sending…" : status === "sent" ? "Sent" : "Send invite"}
          </Button>
        </form>
        {status === "sent" ? (
          <p className="text-muted-foreground mt-3 text-xs">
            Invitation sent to {email.trim().toLowerCase()}.
          </p>
        ) : null}
        {status === "error" && error ? (
          <p className="text-destructive mt-3 text-xs">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
