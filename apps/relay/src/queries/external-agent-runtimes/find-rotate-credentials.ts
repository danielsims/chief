import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesFindRotateCredentials<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          token_secret_ref: externalAgentRuntimes.token_secret_ref,
          delivery_signing_key_id:
            externalAgentRuntimes.delivery_signing_key_id,
          delivery_signing_secret_ref:
            externalAgentRuntimes.delivery_signing_secret_ref,
          registration_result_json:
            externalAgentRuntimes.registration_result_json,
        })
        .from(externalAgentRuntimes)
        .where(eq(externalAgentRuntimes.agent_id, agentId)),
    ),
  );
}
