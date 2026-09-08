import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesFindRuntimeAgentIdEndpointUrlTokenSecretRefConnectionStatus<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          agent_id: externalAgentRuntimes.agent_id,
          endpoint_url: externalAgentRuntimes.endpoint_url,
          token_secret_ref: externalAgentRuntimes.token_secret_ref,
          connection_status: externalAgentRuntimes.connection_status,
        })
        .from(externalAgentRuntimes)
        .where(eq(externalAgentRuntimes.agent_id, agentId)),
    ),
  );
}
