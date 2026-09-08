import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function jobsFindNextAlarm<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).all<Row>(sql`
SELECT MIN(next_at) AS next_at FROM (
           SELECT available_at AS next_at FROM jobs WHERE status = 'pending'
           UNION ALL
           SELECT lease_expires_at AS next_at FROM jobs
             WHERE status = 'leased' AND lease_expires_at IS NOT NULL
         )
`),
  );
}
