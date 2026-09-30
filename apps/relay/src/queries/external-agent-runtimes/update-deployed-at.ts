import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesUpdateDeployedAt(
  storage: DurableObjectStorage,
  { agentId, deployedAt }: { agentId: string; deployedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(externalAgentRuntimes)
        .set({ deployed_at: deployedAt, deployment_issue: null })
        .where(eq(externalAgentRuntimes.agent_id, agentId)),
    ),
  );
}
