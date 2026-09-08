import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceWebhookDeliveries } from "../../db/schema/workspace-webhook-deliveries";

export function workspaceWebhookDeliveriesInsertReceiveDelivery(
  storage: DurableObjectStorage,
  {
    webhookId,
    deliveryId,
    bodyHash,
    runId,
    receivedAt,
  }: {
    webhookId: string;
    deliveryId: string;
    bodyHash: string;
    runId: string;
    receivedAt: number;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(workspaceWebhookDeliveries).values({
        webhook_id: webhookId,
        delivery_id: deliveryId,
        body_hash: bodyHash,
        run_id: runId,
        received_at: receivedAt,
      }),
    ),
  );
}
