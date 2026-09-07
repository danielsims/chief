import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleCommands } from "../../db/schema/workspace-schedule-commands";

export function workspaceScheduleCommandsFindRouteWorkspaceSchedule<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, commandId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          schedule_id: workspaceScheduleCommands.schedule_id,
          action: workspaceScheduleCommands.action,
        })
        .from(workspaceScheduleCommands)
        .where(eq(workspaceScheduleCommands.command_id, commandId)),
    ),
  );
}
