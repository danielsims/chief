import { eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceInvites } from "../../db/schema/workspace-invites";

export function workspaceInvitesUpdateClaim(
  storage: DurableObjectStorage,
  inviteId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(workspaceInvites)
        .set({ use_count: sql`${workspaceInvites.use_count} + ${1}` })
        .where(eq(workspaceInvites.invite_id, inviteId)),
    ),
  );
}
