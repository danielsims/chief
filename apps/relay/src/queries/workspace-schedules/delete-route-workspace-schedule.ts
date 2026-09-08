import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceSchedules } from "../../db/schema/workspace-schedules";

export function workspaceSchedulesDeleteRouteWorkspaceSchedule(
  storage: DurableObjectStorage,
  id: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(db.delete(workspaceSchedules).where(eq(workspaceSchedules.id, id))),
  );
}
