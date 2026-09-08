import { desc, eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleRuns } from "../../db/schema/workspace-schedule-runs";

export function workspaceScheduleRunsFindListScheduleRuns<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, scheduleId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ document_json: workspaceScheduleRuns.document_json })
        .from(workspaceScheduleRuns)
        .where(eq(workspaceScheduleRuns.schedule_id, scheduleId))
        .orderBy(
          desc(workspaceScheduleRuns.created_at),
          desc(sql`${workspaceScheduleRuns}.rowid`),
        )
        .limit(100),
    ),
  );
}
