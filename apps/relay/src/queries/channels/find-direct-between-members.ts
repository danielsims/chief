import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function channelsFindDirectBetweenMembers<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(
  storage: DurableObjectStorage,
  {
    firstKind,
    firstId,
    secondKind,
    secondId,
  }: {
    firstKind: string;
    firstId: string;
    secondKind: string;
    secondId: string;
  },
) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).all<Row>(sql`
SELECT c.* FROM channels c
         WHERE c.kind = 'direct'
           AND EXISTS (SELECT 1 FROM channel_members a
             WHERE a.conversation_id = c.conversation_id
               AND a.principal_kind = ${firstKind} AND a.principal_id = ${firstId})
           AND EXISTS (SELECT 1 FROM channel_members b
             WHERE b.conversation_id = c.conversation_id
               AND b.principal_kind = ${secondKind} AND b.principal_id = ${secondId})
         ORDER BY c.created_at ASC LIMIT 1
`),
  );
}
