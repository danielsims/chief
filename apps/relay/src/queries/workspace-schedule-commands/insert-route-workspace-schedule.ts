import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceScheduleCommands } from "../../db/schema/workspace-schedule-commands";

export function workspaceScheduleCommandsInsertRouteWorkspaceSchedule(
  storage: DurableObjectStorage,
  {
    commandId,
    scheduleId,
    action,
  }: { commandId: string; scheduleId: string; action: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(workspaceScheduleCommands).values({
        command_id: commandId,
        schedule_id: scheduleId,
        action: action,
      }),
    ),
  );
}
