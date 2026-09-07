import { desc, sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { missions } from "../../db/schema/missions";

export function missionsFindRouteWorkspaceMissions<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ document_json: missions.document_json })
        .from(missions)
        .orderBy(desc(sql`${missions}.rowid`)),
    ),
  );
}
