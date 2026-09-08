import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesUpdateVerifyConnection(
  storage: DurableObjectStorage,
  updatedAt: string,
  agentId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(externalAgentRuntimes)
        .set({ connection_status: "connected", updated_at: updatedAt })
        .where(eq(externalAgentRuntimes.agent_id, agentId)),
    ),
  );
}
