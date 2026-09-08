import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentConfigs } from "../../db/schema/agent-configs";

export function agentConfigsUpdateEnableHostedSpecialists(
  storage: DurableObjectStorage,
  {
    configJson,
    updatedAt,
    agentId,
  }: { configJson: string; updatedAt: string; agentId: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(agentConfigs)
        .set({ config_json: configJson, updated_at: updatedAt })
        .where(eq(agentConfigs.agent_id, agentId)),
    ),
  );
}
