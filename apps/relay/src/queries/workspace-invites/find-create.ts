import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceInvites } from "../../db/schema/workspace-invites";

export function workspaceInvitesFindCreate<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, inviteId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.invite_id, inviteId)),
    ),
  );
}
