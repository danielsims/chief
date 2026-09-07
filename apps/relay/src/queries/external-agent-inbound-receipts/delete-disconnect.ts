import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentInboundReceipts } from "../../db/schema/external-agent-inbound-receipts";

export function externalAgentInboundReceiptsDeleteDisconnect(
  storage: DurableObjectStorage,
  agentId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(externalAgentInboundReceipts)
        .where(eq(externalAgentInboundReceipts.agent_id, agentId)),
    ),
  );
}
