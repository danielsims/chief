import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesDeleteDisconnect(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(externalAgentRuntimes)
        .where(eq(externalAgentRuntimes.agent_id, agentId)),
    ),
  );
}
