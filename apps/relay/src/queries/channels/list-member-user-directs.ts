import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

/** Person-to-person direct conversations this principal belongs to. A direct
 * with an agent member is an agent DM and is listed through the snapshot. */
export function channelsListMemberUserDirects<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, principalKind: string, principalId: string) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).all<Row>(sql`
SELECT c.conversation_id, c.workspace_id, c.name, c.is_private,
                c.archived, c.created_at
         FROM channels c
         WHERE c.kind = 'direct'
           AND EXISTS (
             SELECT 1 FROM channel_members me
             WHERE me.conversation_id = c.conversation_id
               AND me.principal_kind = ${principalKind} AND me.principal_id = ${principalId}
           )
           AND NOT EXISTS (
             SELECT 1 FROM channel_members agent
             WHERE agent.conversation_id = c.conversation_id
               AND agent.principal_kind <> 'user'
           )
         ORDER BY created_at ASC, conversation_id ASC
`),
  );
}
