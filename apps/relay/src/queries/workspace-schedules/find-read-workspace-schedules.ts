import { asc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceSchedules } from "../../db/schema/workspace-schedules";

export function workspaceSchedulesFindReadWorkspaceSchedules<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          id: workspaceSchedules.id,
          document_json: workspaceSchedules.document_json,
        })
        .from(workspaceSchedules)
        .orderBy(asc(workspaceSchedules.next_at), asc(workspaceSchedules.id)),
    ),
  );
}
