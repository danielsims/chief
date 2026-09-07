import { desc } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projects } from "../../db/schema/projects";

export function projectsFindWorkspaceProjects<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(db.select().from(projects).orderBy(desc(projects.updated_at))),
  );
}
