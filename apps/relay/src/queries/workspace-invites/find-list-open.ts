import { and, asc, eq, gt, isNull } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceInvites } from "../../db/schema/workspace-invites";

export function workspaceInvitesFindListOpen<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, now: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(workspaceInvites)
        .where(
          and(
            isNull(workspaceInvites.revoked_at),
            eq(workspaceInvites.use_count, 0),
            gt(workspaceInvites.expires_at, now),
          ),
        )
        .orderBy(asc(workspaceInvites.created_at)),
    ),
  );
}
