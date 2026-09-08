import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function resendReconcilingDeliveryExternalAgentOutbox(
  storage: DurableObjectStorage,
  {
    payloadJson,
    deliveryGeneration,
    nextAttemptAt,
    updatedAt,
    agentId,
    deliveryId,
  }: {
    payloadJson: string;
    deliveryGeneration: number;
    nextAttemptAt: string;
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
          status: "queued",
          payload_json: payloadJson,
          delivery_generation: deliveryGeneration,
          attempts: 0,
          next_attempt_at: nextAttemptAt,
          delivering_since: null,
          session_id: null,
          last_error: null,
          updated_at: updatedAt,
        })
        .where(
          and(
            and(
              eq(externalAgentOutbox.agent_id, agentId),
              eq(externalAgentOutbox.delivery_id, deliveryId),
            ),
            eq(externalAgentOutbox.status, "reconciling"),
          ),
        ),
    ),
  );
}
