import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesFindExternalAgentSnapshotRows<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          agent_id: externalAgentRuntimes.agent_id,
          endpoint_url: externalAgentRuntimes.endpoint_url,
          connection_status: externalAgentRuntimes.connection_status,
          registration_result_json:
            externalAgentRuntimes.registration_result_json,
          replaces_native: externalAgentRuntimes.replaces_native,
        })
        .from(externalAgentRuntimes),
    ),
  );
}
