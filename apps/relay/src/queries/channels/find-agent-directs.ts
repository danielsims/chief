import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function channelsFindAgentDirects<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).all<Row>(sql`
SELECT c.conversation_id FROM channels c
         INNER JOIN channel_members cm
           ON cm.conversation_id = c.conversation_id
         WHERE c.kind = 'direct'
           AND cm.principal_kind = 'agent'
           AND cm.principal_id = ${agentId}
`),
  );
}
