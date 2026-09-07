import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { missions } from "../../db/schema/missions";

export function missionsInsertSaveMission(
  storage: DurableObjectStorage,
  missionId: string,
  documentJson: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(missions)
        .values({ mission_id: missionId, document_json: documentJson })
        .onConflictDoUpdate({
          target: [missions.mission_id],
          set: { document_json: sql`excluded.document_json` },
        }),
    ),
  );
}
