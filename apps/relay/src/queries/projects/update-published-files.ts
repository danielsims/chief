import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projects } from "../../db/schema/projects";

export function projectsUpdatePublishedFiles(
  storage: DurableObjectStorage,
  {
    projectId,
    repositoryFilesJson,
    updatedAt,
  }: { projectId: string; repositoryFilesJson: string; updatedAt: string },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(projects)
        .set({
          repository_files_json: repositoryFilesJson,
          updated_at: updatedAt,
        })
        .where(eq(projects.project_id, projectId)),
    ),
  );
}
