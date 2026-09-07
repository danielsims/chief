import { and, eq, ne } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleRuns } from "../../db/schema/workspace-schedule-runs";

export function workspaceScheduleRunsFindAdvanceScheduleRun<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, scheduleId: string, id: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ id: workspaceScheduleRuns.id })
        .from(workspaceScheduleRuns)
        .where(
          and(
            and(
              eq(workspaceScheduleRuns.schedule_id, scheduleId),
              eq(workspaceScheduleRuns.state, "running"),
            ),
            ne(workspaceScheduleRuns.id, id),
          ),
        )
        .limit(1),
    ),
  );
}
