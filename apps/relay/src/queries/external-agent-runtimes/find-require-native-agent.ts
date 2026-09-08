import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesFindRequireNativeAgent<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ agent_id: externalAgentRuntimes.agent_id })
        .from(externalAgentRuntimes)
        .where(eq(externalAgentRuntimes.agent_id, agentId)),
    ),
  );
}
