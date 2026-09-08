import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesUpdateUpdateEndpoint(
  storage: DurableObjectStorage,
  {
    endpointUrl,
    updatedAt,
    agentId,
  }: { endpointUrl: string; updatedAt: string; agentId: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(externalAgentRuntimes)
        .set({ endpoint_url: endpointUrl, updated_at: updatedAt })
        .where(eq(externalAgentRuntimes.agent_id, agentId)),
    ),
  );
}
