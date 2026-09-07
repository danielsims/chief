import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceFiles } from "../../db/schema/workspace-files";

export function workspaceFilesFindSaveBrandProfile<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.file_id, "brand-profile")),
    ),
  );
}
