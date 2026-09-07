import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function externalAgentOutboxFindResolveExternalContinuation<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string, capabilityHash: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          conversation_id: externalAgentOutbox.conversation_id,
          thread_root_id: externalAgentOutbox.thread_root_id,
          session_id: externalAgentOutbox.session_id,
          payload_json: externalAgentOutbox.payload_json,
        })
        .from(externalAgentOutbox)
        .where(
          and(
            and(
              eq(externalAgentOutbox.agent_id, agentId),
              eq(externalAgentOutbox.capability_hash, capabilityHash),
            ),
            eq(externalAgentOutbox.status, "accepted"),
          ),
        ),
    ),
  );
}
