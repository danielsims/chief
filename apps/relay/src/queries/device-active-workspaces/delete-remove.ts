import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { deviceActiveWorkspaces } from "../../db/schema/device-active-workspaces";

export function deviceActiveWorkspacesDeleteRemove(
  storage: DurableObjectStorage,
  workspaceId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .delete(deviceActiveWorkspaces)
        .where(eq(deviceActiveWorkspaces.workspace_id, workspaceId)),
    ),
  );
}
