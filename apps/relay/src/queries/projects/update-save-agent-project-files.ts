import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projects } from "../../db/schema/projects";

export function projectsUpdateSaveAgentProjectFiles(
  storage: DurableObjectStorage,
  {
    name,
    description,
    providerId,
    canonicalRemoteUrl,
    repositoryWebUrl,
    repositoryFilesJson,
    updatedAt,
    projectId,
  }: {
    name: string;
    description: string | null;
    providerId: string;
    canonicalRemoteUrl: string | null;
    repositoryWebUrl: string | null;
    repositoryFilesJson: string | null;
    updatedAt: string;
    projectId: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(projects)
        .set({
          name: name,
          description: description,
          provider_id: providerId,
          canonical_remote_url: canonicalRemoteUrl,
          repository_web_url: repositoryWebUrl,
          repository_files_json: repositoryFilesJson,
          updated_at: updatedAt,
        })
        .where(eq(projects.project_id, projectId)),
    ),
  );
}
