import { and, eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function claimDeliveryExternalAgentOutbox(
  storage: DurableObjectStorage,
  {
    deliveringSince,
    updatedAt,
    agentId,
    deliveryId,
  }: {
    deliveringSince: string | null;
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
          status: "delivering",
          attempts: sql`${externalAgentOutbox.attempts} + ${1}`,
          delivering_since: deliveringSince,
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
