import { and, count, eq, gt } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceWebhookDeliveries } from "../../db/schema/workspace-webhook-deliveries";

export function workspaceWebhookDeliveriesFindReceiveDeliveryCount<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, webhookId: string, receivedAt: number) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ count: count().as("count") })
        .from(workspaceWebhookDeliveries)
        .where(
          and(
            eq(workspaceWebhookDeliveries.webhook_id, webhookId),
            gt(workspaceWebhookDeliveries.received_at, receivedAt),
          ),
        ),
    ),
  );
}
