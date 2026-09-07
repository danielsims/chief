import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { projectRepositories } from "../../db/schema/project-repositories";

export function projectRepositoriesInsertEnsureProjectRepository(
  storage: DurableObjectStorage,
  {
    repositoryId,
    projectId,
    providerId,
    canonicalRemoteUrl,
    providerRepositoryId,
    createdAt,
  }: {
    repositoryId: string;
    projectId: string;
    providerId: string;
    canonicalRemoteUrl: string;
    providerRepositoryId: string;
    createdAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .insert(projectRepositories)
        .values({
          repository_id: repositoryId,
          project_id: projectId,
          provider_id: providerId,
          canonical_remote_url: canonicalRemoteUrl,
          provider_repository_id: providerRepositoryId,
          created_at: createdAt,
        })
        .onConflictDoNothing(),
    ),
  );
}
