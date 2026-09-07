import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function markDeliveryReconcilingExternalAgentOutbox(
  storage: DurableObjectStorage,
  {
    lastError,
    updatedAt,
    agentId,
    deliveryId,
  }: {
    lastError: string | null;
    updatedAt: string;
    agentId: string;
    deliveryId: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(externalAgentOutbox)
        .set({
          status: "reconciling",
          delivering_since: null,
          last_error: lastError,
          updated_at: updatedAt,
        })
        .where(
          and(
            eq(externalAgentOutbox.agent_id, agentId),
            eq(externalAgentOutbox.delivery_id, deliveryId),
          ),
        ),
    ),
  );
}
