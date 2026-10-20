import { and, eq, lt } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceWebhookEvents } from "../../db/schema/workspace-webhook-events";

/** Deletes a webhook's events, or only those received before `before`. */
export function workspaceWebhookEventsDeleteEvents(
  storage: DurableObjectStorage,
  webhookId: string,
  before?: number,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(workspaceWebhookEvents)
        .where(
          before === undefined
            ? eq(workspaceWebhookEvents.webhook_id, webhookId)
            : and(
                eq(workspaceWebhookEvents.webhook_id, webhookId),
                lt(workspaceWebhookEvents.received_at, before),
              ),
        ),
    ),
  );
}
