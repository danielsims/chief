import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentDefinitions } from "../../db/schema/external-agent-definitions";

export function externalAgentDefinitionsInsertRegister(
  storage: DurableObjectStorage,
  {
    agentId,
    projectId,
    repositoryId,
    providerId,
    repositoryIdentity,
    path,
    requestedRef,
    verificationStatus,
    resolvedCommitSha,
    contentDigest,
  }: {
    agentId: string;
    projectId: string;
    repositoryId: string;
    providerId: string;
    repositoryIdentity: string;
    path: string;
    requestedRef: string;
    verificationStatus: string;
    resolvedCommitSha: string | null;
    contentDigest: string | null;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(externalAgentDefinitions).values({
        agent_id: agentId,
        project_id: projectId,
        repository_id: repositoryId,
        provider_id: providerId,
        repository_identity: repositoryIdentity,
        path: path,
        requested_ref: requestedRef,
        verification_status: verificationStatus,
        resolved_commit_sha: resolvedCommitSha,
        content_digest: contentDigest,
      }),
    ),
  );
}
