import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleWebhooks } from "../../db/schema/workspace-schedule-webhooks";

export function workspaceScheduleWebhooksDeleteRouteScheduleWebhooks(
  storage: DurableObjectStorage,
  id: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(workspaceScheduleWebhooks)
        .where(eq(workspaceScheduleWebhooks.id, id)),
    ),
  );
}
