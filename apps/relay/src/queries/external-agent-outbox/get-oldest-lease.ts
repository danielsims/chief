import { and, asc, eq, isNotNull } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentOutbox } from "../../db/schema/external-agent-outbox";

export function getOldestLeaseExternalAgentOutbox<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ delivering_since: externalAgentOutbox.delivering_since })
        .from(externalAgentOutbox)
        .where(
          and(
            eq(externalAgentOutbox.status, "delivering"),
            isNotNull(externalAgentOutbox.delivering_since),
          ),
        )
        .orderBy(asc(externalAgentOutbox.delivering_since))
        .limit(1),
    ),
  );
}
