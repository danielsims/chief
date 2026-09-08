import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { missions } from "../../db/schema/missions";

export function missionsFindReadWorkspaceMission<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, missionId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ document_json: missions.document_json })
        .from(missions)
        .where(eq(missions.mission_id, missionId)),
    ),
  );
}
