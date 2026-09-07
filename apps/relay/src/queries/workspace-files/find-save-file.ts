import { eq, or } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceFiles } from "../../db/schema/workspace-files";

export function workspaceFilesFindSaveFile<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, fileId: string, path: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(workspaceFiles)
        .where(
          or(eq(workspaceFiles.file_id, fileId), eq(workspaceFiles.path, path)),
        )
        .limit(1),
    ),
  );
}
