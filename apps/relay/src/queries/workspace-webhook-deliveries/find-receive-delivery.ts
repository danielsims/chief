import { and, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceWebhookDeliveries } from "../../db/schema/workspace-webhook-deliveries";

export function workspaceWebhookDeliveriesFindReceiveDelivery<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, webhookId: string, deliveryId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          run_id: workspaceWebhookDeliveries.run_id,
          body_hash: workspaceWebhookDeliveries.body_hash,
        })
        .from(workspaceWebhookDeliveries)
        .where(
          and(
            eq(workspaceWebhookDeliveries.webhook_id, webhookId),
            eq(workspaceWebhookDeliveries.delivery_id, deliveryId),
          ),
        ),
    ),
  );
}
