import { and, eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesUpdateDeploymentIssue(
  storage: DurableObjectStorage,
  { agentId, issue }: { agentId: string; issue: string | null },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(externalAgentRuntimes)
        .set({ deployment_issue: issue })
        .where(
          and(
            eq(externalAgentRuntimes.agent_id, agentId),
            sql`${externalAgentRuntimes.deployment_issue} IS NOT ${issue}`,
          ),
        ),
    ),
  );
}
