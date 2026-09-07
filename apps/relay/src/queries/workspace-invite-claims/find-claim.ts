import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceInviteClaims } from "../../db/schema/workspace-invite-claims";

export function workspaceInviteClaimsFindClaim<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, inviteId: string, userId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(workspaceInviteClaims)
        .where(
          and(
            eq(workspaceInviteClaims.invite_id, inviteId),
            eq(workspaceInviteClaims.user_id, userId),
          ),
        ),
    ),
  );
}
