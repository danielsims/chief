import { and, asc, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function listReconcilingDeliveriesExternalAgentOutbox<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          delivery_id: externalAgentOutbox.delivery_id,
          delivery_generation: externalAgentOutbox.delivery_generation,
          last_error: externalAgentOutbox.last_error,
          created_at: externalAgentOutbox.created_at,
        })
        .from(externalAgentOutbox)
        .where(
          and(
            eq(externalAgentOutbox.agent_id, agentId),
            eq(externalAgentOutbox.status, "reconciling"),
          ),
        )
        .orderBy(asc(externalAgentOutbox.created_at)),
    ),
  );
}
