import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentInboundReceipts } from "../../db/schema/external-agent-inbound-receipts";

export function externalAgentInboundReceiptsUpdateReceiveExternalAgentMessage(
  storage: DurableObjectStorage,
  {
    updatedAt,
    agentId,
    deliveryId,
  }: { updatedAt: string; agentId: string; deliveryId: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(externalAgentInboundReceipts)
        .set({ status: "accepted", updated_at: updatedAt })
        .where(
          and(
            eq(externalAgentInboundReceipts.agent_id, agentId),
            eq(externalAgentInboundReceipts.delivery_id, deliveryId),
          ),
        ),
    ),
  );
}
