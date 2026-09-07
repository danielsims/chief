import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function workspaceSchedulesFindNextDeadline<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).all<Row>(sql`
SELECT MIN(deadline) AS deadline FROM (
    SELECT MIN(next_at) AS deadline FROM workspace_schedules
    UNION ALL SELECT MIN(next_check_at) AS deadline FROM workspace_schedule_runs
  )
`),
  );
}
