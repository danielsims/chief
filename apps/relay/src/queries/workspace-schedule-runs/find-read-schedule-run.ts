import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleRuns } from "../../db/schema/workspace-schedule-runs";

export function workspaceScheduleRunsFindReadScheduleRun<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, id: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          document_json: workspaceScheduleRuns.document_json,
          principal_json: workspaceScheduleRuns.principal_json,
        })
        .from(workspaceScheduleRuns)
        .where(eq(workspaceScheduleRuns.id, id)),
    ),
  );
}
