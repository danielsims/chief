import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentInboundReceipts } from "../../db/schema/external-agent-inbound-receipts";

export function externalAgentInboundReceiptsInsertReceiveExternalAgentMessage(
  storage: DurableObjectStorage,
  {
    agentId,
    deliveryId,
    payloadHash,
    messageId,
    createdAt,
    updatedAt,
  }: {
    agentId: string;
    deliveryId: string;
    payloadHash: string;
    messageId: string;
    createdAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(externalAgentInboundReceipts).values({
        agent_id: agentId,
        delivery_id: deliveryId,
        payload_hash: payloadHash,
        message_id: messageId,
        status: "claimed",
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ),
  );
}
