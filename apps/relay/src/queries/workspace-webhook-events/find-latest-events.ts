import { desc, eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceWebhookEvents } from "../../db/schema/workspace-webhook-events";

export function workspaceWebhookEventsFindLatestEvents<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, webhookId: string, limit: number) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          received_at: workspaceWebhookEvents.received_at,
          input_json: workspaceWebhookEvents.input_json,
        })
        .from(workspaceWebhookEvents)
        .where(eq(workspaceWebhookEvents.webhook_id, webhookId))
        .orderBy(
          desc(workspaceWebhookEvents.received_at),
          desc(sql`${workspaceWebhookEvents}.rowid`),
        )
        .limit(limit),
    ),
  );
}
