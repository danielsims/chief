import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentConfigs } from "../../db/schema/agent-configs";

export function agentConfigsListAll<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          agent_id: agentConfigs.agent_id,
          config_json: agentConfigs.config_json,
          updated_at: agentConfigs.updated_at,
        })
        .from(agentConfigs),
    ),
  );
}
