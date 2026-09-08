import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { agentConfigs } from "../../db/schema/agent-configs";

export function agentConfigsInsertConfigSet(
  storage: DurableObjectStorage,
  {
    agentId,
    configJson,
    updatedAt,
  }: { agentId: string; configJson: string; updatedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(agentConfigs)
        .values({
          agent_id: agentId,
          config_json: configJson,
          updated_at: updatedAt,
        })
        .onConflictDoUpdate({
          target: [agentConfigs.agent_id],
          set: {
            config_json: sql`excluded.config_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    ),
  );
}
