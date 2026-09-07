import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projects } from "../../db/schema/projects";

export function projectsUpdateBackfillAgentProjectFiles(
  storage: DurableObjectStorage,
  {
    agentId,
    description,
    repositoryFilesJson,
    projectId,
  }: {
    agentId: string | null;
    description: string | null;
    repositoryFilesJson: string | null;
    projectId: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(projects)
        .set({
          agent_id: agentId,
          description: description,
          repository_files_json: repositoryFilesJson,
        })
        .where(eq(projects.project_id, projectId)),
    ),
  );
}
