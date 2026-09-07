import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projectRepositories } from "../../db/schema/project-repositories";

export function projectRepositoriesFindProjectRepository<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage, projectId: string) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select()
        .from(projectRepositories)
        .where(eq(projectRepositories.project_id, projectId)),
    ),
  );
}
