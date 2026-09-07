import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceInviteClaims } from "../../db/schema/workspace-invite-claims";

export function workspaceInviteClaimsInsertClaim(
  storage: DurableObjectStorage,
  {
    inviteId,
    userId,
    claimedAt,
  }: { inviteId: string; userId: string; claimedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(workspaceInviteClaims).values({
        invite_id: inviteId,
        user_id: userId,
        claimed_at: claimedAt,
      }),
    ),
  );
}
