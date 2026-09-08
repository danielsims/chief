import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentKeys } from "../../db/schema/agent-keys";

export function agentKeysInsertRegisterAgentKey(
  storage: DurableObjectStorage,
  {
    agentId,
    pubkey,
    createdAt,
  }: { agentId: string; pubkey: string; createdAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(agentKeys)
        .values({ agent_id: agentId, pubkey: pubkey, created_at: createdAt }),
    ),
  );
}
