import { desc, eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { log } from "../../db/schema/log";

export function logFindReadWorkspaceLogsWorkspaceId<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, workspaceId: string, limit: number) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(log)
        .where(eq(log.workspace_id, workspaceId))
        .orderBy(desc(log.sequence))
        .limit(limit),
    ),
  );
}
