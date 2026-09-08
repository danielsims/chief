import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentKeys } from "../../db/schema/agent-keys";

export function agentKeysFindAgentPubkey<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ pubkey: agentKeys.pubkey })
        .from(agentKeys)
        .where(eq(agentKeys.agent_id, agentId)),
    ),
  );
}
