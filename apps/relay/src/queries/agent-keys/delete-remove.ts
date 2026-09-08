import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentKeys } from "../../db/schema/agent-keys";

export function agentKeysDeleteRemove(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(db.delete(agentKeys).where(eq(agentKeys.agent_id, agentId))),
  );
}
