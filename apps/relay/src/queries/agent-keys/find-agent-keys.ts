import { asc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentKeys } from "../../db/schema/agent-keys";

export function agentKeysFindAgentKeys<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ agent_id: agentKeys.agent_id, pubkey: agentKeys.pubkey })
        .from(agentKeys)
        .orderBy(asc(agentKeys.agent_id)),
    ),
  );
}
