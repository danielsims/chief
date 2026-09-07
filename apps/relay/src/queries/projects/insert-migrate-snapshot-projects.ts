import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projects } from "../../db/schema/projects";

export function projectsInsertMigrateSnapshotProjects(
  storage: DurableObjectStorage,
  {
    projectId,
    agentId,
    name,
    description,
    repositoryKind,
    providerId,
    canonicalRemoteUrl,
    repositoryWebUrl,
    repositoryFilesJson,
    defaultBranch,
    createdAt,
    updatedAt,
  }: {
    projectId: string;
    agentId: string | null;
    name: string;
    description: string | null;
    repositoryKind: string;
    providerId: string;
    canonicalRemoteUrl: string | null;
    repositoryWebUrl: string | null;
    repositoryFilesJson: string | null;
    defaultBranch: string;
    createdAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(projects)
        .values({
          project_id: projectId,
          agent_id: agentId,
          name: name,
          description: description,
          repository_kind: repositoryKind,
          provider_id: providerId,
          canonical_remote_url: canonicalRemoteUrl,
          repository_web_url: repositoryWebUrl,
          repository_files_json: repositoryFilesJson,
          default_branch: defaultBranch,
          created_at: createdAt,
          updated_at: updatedAt,
        })
        .onConflictDoNothing(),
    ),
  );
}
