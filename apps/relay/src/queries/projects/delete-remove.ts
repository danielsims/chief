import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projects } from "../../db/schema/projects";

export function projectsDeleteRemove(
  storage: DurableObjectStorage,
  projectId: string,
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(db.delete(projects).where(eq(projects.project_id, projectId))),
  );
}
