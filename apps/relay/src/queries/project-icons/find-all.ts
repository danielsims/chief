import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projectIcons } from "../../db/schema/project-icons";

export function projectIconsFindAll(storage: DurableObjectStorage) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.all<{ project_id: string; data_url: string }>(
      db
        .select({
          project_id: projectIcons.project_id,
          data_url: projectIcons.data_url,
        })
        .from(projectIcons),
    ),
  );
}
