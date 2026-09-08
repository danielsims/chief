import { asc, inArray } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function getNextAttemptExternalAgentOutbox<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ next_attempt_at: externalAgentOutbox.next_attempt_at })
        .from(externalAgentOutbox)
        .where(inArray(externalAgentOutbox.status, ["queued", "retry"]))
        .orderBy(asc(externalAgentOutbox.next_attempt_at))
        .limit(1),
    ),
  );
}
