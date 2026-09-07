import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceSchedules } from "../../db/schema/workspace-schedules";

export function workspaceSchedulesInsertWriteWorkspaceSchedule(
  storage: DurableObjectStorage,
  {
    id,
    documentJson,
    nextAt,
  }: { id: string; documentJson: string; nextAt: number | null },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(workspaceSchedules)
        .values({ id: id, document_json: documentJson, next_at: nextAt })
        .onConflictDoUpdate({
          target: [workspaceSchedules.id],
          set: {
            document_json: sql`excluded.document_json`,
            next_at: sql`excluded.next_at`,
          },
        }),
    ),
  );
}
