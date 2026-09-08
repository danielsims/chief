import { desc, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleWebhooks } from "../../db/schema/workspace-schedule-webhooks";

export function workspaceScheduleWebhooksFindRouteScheduleWebhooks<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ document_json: workspaceScheduleWebhooks.document_json })
        .from(workspaceScheduleWebhooks)
        .orderBy(desc(sql`${workspaceScheduleWebhooks}.rowid`)),
    ),
  );
}
