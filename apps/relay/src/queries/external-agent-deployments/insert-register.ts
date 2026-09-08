import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentDeployments } from "../../db/schema/external-agent-deployments";

export function externalAgentDeploymentsInsertRegister(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(externalAgentDeployments)
        .values({ agent_id: agentId, status: "unattested" }),
    ),
  );
}
