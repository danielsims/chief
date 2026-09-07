import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";

export function workspaceScheduleRunsListScheduledTimes<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(
  storage: DurableObjectStorage,
  { scheduleId, from, to }: { scheduleId: string; from: number; to: number },
) {
  return executeDatabaseQuery(() =>
    relayDatabase(storage).all<Row>(sql`
SELECT DISTINCT CAST(json_extract(document_json, '$.scheduledAt') AS INTEGER) AS at FROM workspace_schedule_runs WHERE schedule_id = ${scheduleId} AND at >= ${from} AND at < ${to} ORDER BY at
`),
  );
}
