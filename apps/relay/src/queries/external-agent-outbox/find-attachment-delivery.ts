import { and, eq, inArray } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

/**
 * The live delivery a capability was issued for: still being delivered, or
 * accepted and running. A settled or dropped delivery reads nothing.
 */
export function externalAgentOutboxFindAttachmentDelivery<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string, capabilityHash: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          conversation_id: externalAgentOutbox.conversation_id,
          payload_json: externalAgentOutbox.payload_json,
        })
        .from(externalAgentOutbox)
        .where(
          and(
            eq(externalAgentOutbox.agent_id, agentId),
            eq(externalAgentOutbox.capability_hash, capabilityHash),
            inArray(externalAgentOutbox.status, ["delivering", "accepted"]),
          ),
        ),
    ),
  );
}
