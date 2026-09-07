import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function acceptDeliveryExternalAgentOutbox(
  storage: DurableObjectStorage,
  {
    sessionId,
    updatedAt,
    agentId,
    deliveryId,
  }: {
    sessionId: string | null;
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
          status: "accepted",
          session_id: sessionId,
          delivering_since: null,
          last_error: null,
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
