import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function insertDeliveryExternalAgentOutbox(
  storage: DurableObjectStorage,
  {
    agentId,
    deliveryId,
    payloadHash,
    payloadJson,
    capabilityHash,
    conversationId,
    threadRootId,
    sessionAddress,
    nextAttemptAt,
    createdAt,
    updatedAt,
  }: {
    agentId: string;
    deliveryId: string;
    payloadHash: string;
    payloadJson: string;
    capabilityHash: string;
    conversationId: string;
    threadRootId: string | null;
    sessionAddress: string;
    nextAttemptAt: string;
    createdAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(externalAgentOutbox).values({
        agent_id: agentId,
        delivery_id: deliveryId,
        payload_hash: payloadHash,
        payload_json: payloadJson,
        capability_hash: capabilityHash,
        conversation_id: conversationId,
        thread_root_id: threadRootId,
        session_address: sessionAddress,
        delivery_generation: 1,
        status: "queued",
        attempts: 0,
        next_attempt_at: nextAttemptAt,
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ),
  );
}
