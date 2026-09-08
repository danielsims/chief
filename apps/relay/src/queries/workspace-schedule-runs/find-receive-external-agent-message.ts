import { eq, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleRuns } from "../../db/schema/workspace-schedule-runs";

export function workspaceScheduleRunsFindReceiveExternalAgentMessage<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, value: SqlStorageValue) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ id: workspaceScheduleRuns.id })
        .from(workspaceScheduleRuns)
        .where(
          eq(
            sql`json_extract(${workspaceScheduleRuns.document_json}, ${"$.threadRootId"})`,
            value,
          ),
        )
        .limit(1),
    ),
  );
}
