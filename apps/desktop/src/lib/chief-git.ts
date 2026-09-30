import type { RelayClient } from "@chief/relay-client";
import {
  chiefGitRemoteUrl,
  chiefGitRepoSlug,
} from "@chief/agent-runtime/git-objects";

import { RELAY_URL } from "./config";

/**
 * Creates a repository hosted by the workspace's own relay, so a team can
 * work in source control without connecting an outside Git provider.
 */
export async function createChiefGitRepository(
  client: Pick<RelayClient, "createProject">,
  workspaceId: string,
  name: string,
) {
  const trimmed = name.trim();
  return await client.createProject({
    name: trimmed,
    repositoryKind: "cloned",
    providerId: "chief-git",
    canonicalRemoteUrl: chiefGitRemoteUrl(
      new URL(RELAY_URL).origin,
      workspaceId,
      chiefGitRepoSlug(trimmed),
    ),
    defaultBranch: "main",
    repositoryFiles: [{ path: "README.md", content: `# ${trimmed}\n` }],
  });
}
