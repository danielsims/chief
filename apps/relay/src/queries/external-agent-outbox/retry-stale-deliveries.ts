import { and, eq, lt } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function retryStaleDeliveriesExternalAgentOutbox(
  storage: DurableObjectStorage,
  nextAttemptAt: string,
  deliveringSince: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(externalAgentOutbox)
        .set({
          status: "retry",
          next_attempt_at: nextAttemptAt,
          delivering_since: null,
        })
        .where(
          and(
            eq(externalAgentOutbox.status, "delivering"),
            lt(externalAgentOutbox.delivering_since, deliveringSince),
          ),
        ),
    ),
  );
}
