import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentKeys } from "../../db/schema/agent-keys";

export function agentKeysFindRegisterAgentKey<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          agent_id: agentKeys.agent_id,
          pubkey: agentKeys.pubkey,
          created_at: agentKeys.created_at,
        })
        .from(agentKeys)
        .where(eq(agentKeys.agent_id, agentId)),
    ),
  );
}
