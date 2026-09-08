import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projects } from "../../db/schema/projects";

export function projectsFindProjectIdsOwnedByAgent<
  Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>,
>(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<Row>(
      db
        .select({
          project_id: projects.project_id,
          agent_id: projects.agent_id,
          name: projects.name,
        })
        .from(projects),
    ),
  );
}
