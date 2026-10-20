import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceWebhookEvents } from "../../db/schema/workspace-webhook-events";

export function workspaceWebhookEventsInsertEvent(
  storage: DurableObjectStorage,
  {
    webhookId,
    receivedAt,
    inputJson,
  }: { webhookId: string; receivedAt: number; inputJson: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(workspaceWebhookEvents).values({
        webhook_id: webhookId,
        received_at: receivedAt,
        input_json: inputJson,
      }),
    ),
  );
}
