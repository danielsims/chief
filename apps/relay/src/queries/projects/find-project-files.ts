import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projects } from "../../db/schema/projects";

export function projectsFindProjectFiles<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, projectId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({ repository_files_json: projects.repository_files_json })
        .from(projects)
        .where(eq(projects.project_id, projectId)),
    ),
  );
}
