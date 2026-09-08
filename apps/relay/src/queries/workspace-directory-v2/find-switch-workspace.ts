import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceDirectoryV2 } from "../../db/schema/workspace-directory-v2";

export function workspaceDirectoryV2FindSwitchWorkspace<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, workspaceId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(workspaceDirectoryV2)
        .where(eq(workspaceDirectoryV2.workspace_id, workspaceId)),
    ),
  );
}
