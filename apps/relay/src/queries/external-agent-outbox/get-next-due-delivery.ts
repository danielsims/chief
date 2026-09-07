import { and, asc, inArray, lte } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function getNextDueDeliveryExternalAgentOutbox<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, nextAttemptAt: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(externalAgentOutbox)
        .where(
          and(
            inArray(externalAgentOutbox.status, ["queued", "retry"]),
            lte(externalAgentOutbox.next_attempt_at, nextAttemptAt),
          ),
        )
        .orderBy(
          asc(externalAgentOutbox.next_attempt_at),
          asc(externalAgentOutbox.created_at),
        )
        .limit(1),
    ),
  );
}
