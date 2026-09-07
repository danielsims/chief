import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { workspaceFiles } from "../../db/schema/workspace-files";

export function workspaceFilesUpdateUpdateFile(
  storage: DurableObjectStorage,
  {
    title,
    content,
    version,
    updatedAt,
    fileId,
  }: {
    title: string;
    content: string;
    version: number;
    updatedAt: string;
    fileId: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(workspaceFiles)
        .set({
          title: title,
          content: content,
          version: version,
          updated_at: updatedAt,
        })
        .where(eq(workspaceFiles.file_id, fileId)),
    ),
  );
}
