import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function channelsListVisibleChannels<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, principalKind: string, principalId: string) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).all<Row>(sql`
SELECT c.conversation_id, c.workspace_id, c.name, c.is_private,
                c.archived, c.created_at
         FROM channels c
         WHERE c.kind = 'channel' AND (c.is_private = 0 OR EXISTS (
           SELECT 1 FROM channel_members cm
           WHERE cm.conversation_id = c.conversation_id
             AND cm.principal_kind = ${principalKind} AND cm.principal_id = ${principalId}
         ))
         ORDER BY archived ASC, created_at ASC, conversation_id ASC
`),
  );
}
