import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function getDeliveryExternalAgentOutbox<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string, deliveryId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(externalAgentOutbox)
        .where(
          and(
            eq(externalAgentOutbox.agent_id, agentId),
            eq(externalAgentOutbox.delivery_id, deliveryId),
          ),
        ),
    ),
  );
}
