import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function recordDeliveryFailureExternalAgentOutbox(
  storage: DurableObjectStorage,
  {
    status,
    nextAttemptAt,
    lastError,
    updatedAt,
    agentId,
    deliveryId,
  }: {
    status: string;
    nextAttemptAt: string;
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
          status: status,
          next_attempt_at: nextAttemptAt,
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
