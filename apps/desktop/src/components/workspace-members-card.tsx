import { useState } from "react";
import { toast } from "sonner";

import type { WorkspaceMember } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { cn } from "@chief/ui/lib/utils";

import { relayAvatarUrl } from "../lib/relay-avatar";
import { useRelaySession } from "../lib/relay-session";

/**
 * Roster of the people in a workspace. Every member can see who else has
 * access; owners and admins can remove people. Invitation management lives in
 * its own card.
 */
export function WorkspaceMembersCard({
  members,
  workspaceName,
  error,
  canManage = false,
  currentUserId,
  onChanged,
}: {
  members: readonly WorkspaceMember[];
  workspaceName: string;
  error?: string | null;
  canManage?: boolean;
  currentUserId?: string | null;
  onChanged?: () => Promise<void>;
}) {
  const { client } = useRelaySession();
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const people = members.filter((member) => member.kind === "user");

  const remove = async (member: WorkspaceMember) => {
    if (!client || busyMember) return;
    setBusyMember(member.principalId);
    setActionError(null);
    try {
      await client.removeWorkspaceMember(member.kind, member.principalId);
      toast.success(`Removed ${member.name ?? member.principalId}`);
      await onChanged?.();
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Chief couldn’t remove this member.";
      setActionError(message);
      toast.error(message);
    } finally {
      setBusyMember(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          People with access to {workspaceName}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error || actionError ? (
          <p className="text-destructive text-xs">{actionError ?? error}</p>
        ) : people.length === 0 ? (
          <p className="text-muted-foreground text-sm">No members yet.</p>
        ) : (
          <ul className="divide-border border-border divide-y overflow-hidden rounded-xl border">
            {people.map((member) => (
              <li
                className="flex items-center gap-3 px-4 py-2.5"
                key={member.principalId}
              >
                <MemberAvatar
                  image={member.image}
                  name={member.name ?? member.principalId}
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {member.name ?? member.principalId}
                </span>
                <span className="text-muted-foreground text-xs capitalize">
                  {member.role}
                </span>
                {canManage && member.principalId !== currentUserId ? (
                  <Button
                    disabled={busyMember === member.principalId}
                    onClick={() => void remove(member)}
                    size="sm"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** A member's avatar, falling back to their initial when it can't load. */
function MemberAvatar({ image, name }: { image?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = relayAvatarUrl(image);
  if (src && !failed) {
    return (
      <img
        alt=""
        className="bg-muted size-7 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
        src={src}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "bg-muted text-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs",
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
