import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspace } from "../../db/schema/workspace";

export function workspaceFindWorkspaceAgent<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ snapshot_json: workspace.snapshot_json })
        .from(workspace)
        .where(eq(workspace.singleton, 1)),
    ),
  );
}
