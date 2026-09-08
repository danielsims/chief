import { sql } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleRuns } from "../../db/schema/workspace-schedule-runs";

export function workspaceScheduleRunsInsertWriteScheduleRun(
  storage: DurableObjectStorage,
  {
    id,
    scheduleId,
    state,
    nextCheckAt,
    createdAt,
    documentJson,
    principalJson,
  }: {
    id: string;
    scheduleId: string;
    state: string;
    nextCheckAt: number | null;
    createdAt: number;
    documentJson: string;
    principalJson: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(workspaceScheduleRuns)
        .values({
          id: id,
          schedule_id: scheduleId,
          state: state,
          next_check_at: nextCheckAt,
          created_at: createdAt,
          document_json: documentJson,
          principal_json: principalJson,
        })
        .onConflictDoUpdate({
          target: [workspaceScheduleRuns.id],
          set: {
            state: sql`excluded.state`,
            next_check_at: sql`excluded.next_check_at`,
            document_json: sql`excluded.document_json`,
          },
        }),
    ),
  );
}
