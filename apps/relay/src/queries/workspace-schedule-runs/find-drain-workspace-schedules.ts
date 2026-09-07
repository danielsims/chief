import { asc, lte, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleRuns } from "../../db/schema/workspace-schedule-runs";

export function workspaceScheduleRunsFindDrainWorkspaceSchedules<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, nextCheckAt: number) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ id: workspaceScheduleRuns.id })
        .from(workspaceScheduleRuns)
        .where(lte(workspaceScheduleRuns.next_check_at, nextCheckAt))
        .orderBy(
          asc(workspaceScheduleRuns.created_at),
          asc(sql`${workspaceScheduleRuns}.rowid`),
        )
        .limit(20),
    ),
  );
}
