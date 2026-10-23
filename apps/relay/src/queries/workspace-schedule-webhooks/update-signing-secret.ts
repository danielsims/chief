import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleWebhooks } from "../../db/schema/workspace-schedule-webhooks";

export function workspaceScheduleWebhooksUpdateSigningSecret(
  storage: DurableObjectStorage,
  { id, signingSecret }: { id: string; signingSecret: string | null },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(workspaceScheduleWebhooks)
        .set({ signing_secret: signingSecret })
        .where(eq(workspaceScheduleWebhooks.id, id)),
    ),
  );
}
