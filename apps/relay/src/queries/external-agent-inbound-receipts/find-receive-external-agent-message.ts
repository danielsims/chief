import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentInboundReceipts } from "../../db/schema/external-agent-inbound-receipts";

export function externalAgentInboundReceiptsFindReceiveExternalAgentMessage<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, agentId: string, deliveryId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(externalAgentInboundReceipts)
        .where(
          and(
            eq(externalAgentInboundReceipts.agent_id, agentId),
            eq(externalAgentInboundReceipts.delivery_id, deliveryId),
          ),
        ),
    ),
  );
}
