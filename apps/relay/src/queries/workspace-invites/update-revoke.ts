import { and, eq, isNull } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceInvites } from "../../db/schema/workspace-invites";

export function workspaceInvitesUpdateRevoke(
  storage: DurableObjectStorage,
  inviteId: string,
  revokedAt: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(workspaceInvites)
        .set({ revoked_at: revokedAt })
        .where(
          and(
            eq(workspaceInvites.invite_id, inviteId),
            isNull(workspaceInvites.revoked_at),
          ),
        ),
    ),
  );
}
