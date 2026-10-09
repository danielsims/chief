import { z } from "zod";

import { HttpError, json, parseJson } from "./http";
import { readTrustedContext } from "./internal-context";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { ensureProjectImported } from "./workspace-git-import";
import {
  gitRepoSlug,
  publishGitTree,
  readGitHead,
} from "./workspace-git-store";
import { signWorkspaceGitToken } from "./workspace-git-token";
import { workspaceGitRepositoryFiles } from "./workspace-project-git";
import { recordPublishedProjectFiles } from "./workspace-project-store";

const gitTokenRequestSchema = z.object({
  repo: z.string().trim().min(1).max(128),
});

/**
 * Mints a short-lived, read-only clone credential for one repository. Only a
 * workspace member agent may request one, and only for a repository that
 * actually exists in this workspace. The credential is scoped to this
 * workspace and repository and expires quickly.
 */
export async function mintGitToken(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requirePrincipalMember(context.principal);
  if (context.principal.kind !== "agent") {
    throw new HttpError(
      403,
      "agent_required",
      "Only an agent may request a repository credential.",
    );
  }
  // Minting can import a GitHub project into the workspace, so it needs the
  // same capability as reading projects.
  channels.requireAgentCapability(context.principal, "projects.read");
  const { repo: requested } = gitTokenRequestSchema.parse(
    await parseJson(request),
  );
  const repo = gitRepoSlug(requested);
  const exists =
    readGitHead(storage, repo) !== undefined ||
    workspaceGitRepositoryFiles(storage, repo) !== undefined;
  if (!exists) {
    // First use of a GitHub project: import its files into the workspace Git
    // host so the agent has something to clone.
    const imported = await ensureProjectImported(
      storage,
      env,
      context.principal,
      repo,
    );
    if (!imported) {
      throw new HttpError(
        404,
        "git_repository_not_found",
        "This workspace Git repository does not exist.",
      );
    }
  }
  const { token, expiresAt } = await signWorkspaceGitToken(
    env.RELAY_SECRET_KEY,
    {
      workspaceId: context.workspaceId,
      repo,
      agentId: context.principal.agentId,
    },
  );
  return json({ token, repo, expiresAt });
}

const MAX_PUBLISH_BYTES = 6_000_000;

const gitPublishSchema = z.object({
  repo: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(2_000),
  files: z
    .array(
      z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .max(1_024)
          .refine(
            (path) =>
              !path.startsWith("/") &&
              path
                .split("/")
                .every(
                  (segment) =>
                    segment !== "" && segment !== "." && segment !== "..",
                ),
            "Repository paths must be relative and cannot traverse.",
          ),
        content: z.string(),
      }),
    )
    .max(5_000)
    // The tool bounds this too, but the relay never trusts the caller to.
    .refine(
      (files) =>
        files.reduce((total, file) => total + file.content.length, 0) <=
        MAX_PUBLISH_BYTES,
      "This working tree is too large to publish.",
    ),
});

/**
 * Publishes an agent's working tree as a commit on top of the repository's
 * current head. Requires the agent to hold the projects.write capability. The
 * commit is built by the relay from files, never from a pushed packfile, so no
 * untrusted Git wire data is ever parsed.
 */
export async function publishGitTreeFromAgent(
  storage: DurableObjectStorage,
  env: Env,
  request: Request,
) {
  const context = readTrustedContext(request);
  const channels = new WorkspaceChannelStore(storage, env);
  channels.requirePrincipalMember(context.principal);
  if (context.principal.kind !== "agent") {
    throw new HttpError(
      403,
      "agent_required",
      "Only an agent may publish to a workspace Git repository.",
    );
  }
  channels.requireAgentCapability(context.principal, "projects.write");
  const input = gitPublishSchema.parse(await parseJson(request));
  const repo = gitRepoSlug(input.repo);
  if (
    readGitHead(storage, repo) === undefined &&
    workspaceGitRepositoryFiles(storage, repo) === undefined
  ) {
    throw new HttpError(
      404,
      "git_repository_not_found",
      "This workspace Git repository does not exist.",
    );
  }
  const result = await publishGitTree(storage, {
    repo,
    files: input.files,
    message: input.message,
    authorName: context.principal.agentId,
  });
  recordPublishedProjectFiles(storage, context.workspaceId, repo, input.files);
  return json(result);
}
