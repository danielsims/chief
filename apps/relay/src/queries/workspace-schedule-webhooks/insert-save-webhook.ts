import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleWebhooks } from "../../db/schema/workspace-schedule-webhooks";

export function workspaceScheduleWebhooksInsertSaveWebhook(
  storage: DurableObjectStorage,
  {
    id,
    documentJson,
    secret,
  }: { id: string; documentJson: string; secret: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(workspaceScheduleWebhooks)
        .values({ id: id, document_json: documentJson, secret: secret })
        .onConflictDoUpdate({
          target: [workspaceScheduleWebhooks.id],
          set: {
            document_json: sql`excluded.document_json`,
            secret: sql`excluded.secret`,
          },
        }),
    ),
  );
}
