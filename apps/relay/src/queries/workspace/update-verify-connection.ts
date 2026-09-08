import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspace } from "../../db/schema/workspace";

export function workspaceUpdateVerifyConnection(
  storage: DurableObjectStorage,
  snapshotJson: string | null,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(workspace)
        .set({ snapshot_json: snapshotJson })
        .where(eq(workspace.singleton, 1)),
    ),
  );
}
