import { and, desc, eq, lt } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { log } from "../../db/schema/log";

export function logFindReadWorkspaceLogs<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(
  storage: DurableObjectStorage,
  {
    workspaceId,
    sequence,
    limit,
  }: { workspaceId: string; sequence: number; limit: number },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(log)
        .where(
          and(eq(log.workspace_id, workspaceId), lt(log.sequence, sequence)),
        )
        .orderBy(desc(log.sequence))
        .limit(limit),
    ),
  );
}
