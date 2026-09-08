import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceSchedules } from "../../db/schema/workspace-schedules";

export function workspaceSchedulesFindReadWorkspaceSchedule<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, id: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          id: workspaceSchedules.id,
          document_json: workspaceSchedules.document_json,
        })
        .from(workspaceSchedules)
        .where(eq(workspaceSchedules.id, id)),
    ),
  );
}
