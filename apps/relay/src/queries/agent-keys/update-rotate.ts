import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentKeys } from "../../db/schema/agent-keys";

/** Replace only the identity the owner explicitly approved replacing. */
export function agentKeysUpdateRotate(
  storage: DurableObjectStorage,
  agentId: string,
  pubkey: string,
  previousPubkey: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<{ agent_id: string }>(
      db
        .update(agentKeys)
        .set({ pubkey })
        .where(
          and(
            eq(agentKeys.agent_id, agentId),
            eq(agentKeys.pubkey, previousPubkey),
          ),
        )
        .returning({ agent_id: agentKeys.agent_id }),
    ),
  );
}
