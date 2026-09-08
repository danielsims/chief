import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleWebhooks } from "../../db/schema/workspace-schedule-webhooks";

export function workspaceScheduleWebhooksFindReadWebhook<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, id: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          document_json: workspaceScheduleWebhooks.document_json,
          secret: workspaceScheduleWebhooks.secret,
        })
        .from(workspaceScheduleWebhooks)
        .where(eq(workspaceScheduleWebhooks.id, id)),
    ),
  );
}
