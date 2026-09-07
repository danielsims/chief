import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesFindUpdateEndpoint<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          endpoint_url: externalAgentRuntimes.endpoint_url,
          token_secret_ref: externalAgentRuntimes.token_secret_ref,
          delivery_signing_key_id:
            externalAgentRuntimes.delivery_signing_key_id,
          delivery_signing_secret_ref:
            externalAgentRuntimes.delivery_signing_secret_ref,
          registration_result_json:
            externalAgentRuntimes.registration_result_json,
          replaces_native: externalAgentRuntimes.replaces_native,
        })
        .from(externalAgentRuntimes)
        .where(eq(externalAgentRuntimes.agent_id, agentId)),
    ),
  );
}
