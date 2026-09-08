import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function externalAgentOutboxDeleteDisconnect(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(externalAgentOutbox)
        .where(eq(externalAgentOutbox.agent_id, agentId)),
    ),
  );
}
