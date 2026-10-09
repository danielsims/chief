import { buildGitRepository } from "@chief/agent-runtime/git-objects";
import { projectRepositoryFilesSchema } from "@chief/relay-contracts";

import { HttpError } from "./http";
import { githubRepositoryIdentity } from "./project-repository";
import { projectRepositoriesInsertEnsureProjectRepository } from "./queries/project-repositories/insert-ensure-project-repository";
import { projectsFindWorkspaceGitRepositoryFiles } from "./queries/projects/find-workspace-git-repository-files";
import { serveWorkspaceGitHttp } from "./workspace-git-http";
import {
  GIT_HEAD_REF,
  gitRepoSlug,
  readGitRefs,
  readGitRepository,
  writeGitCommit,
} from "./workspace-git-store";

export interface ProjectRow extends Record<string, SqlStorageValue> {
  project_id: string;
  agent_id: string | null;
  name: string;
  description: string | null;
  repository_kind: "attached" | "cloned";
  provider_id:
    "local" | "generic-git" | "github" | "chief-git" | "gitlab" | "bitbucket";
  canonical_remote_url: string | null;
  repository_web_url: string | null;
  repository_files_json: string | null;
  default_branch: string;
  created_at: string;
  updated_at: string;
}

export async function serveProjectGit(
  storage: DurableObjectStorage,
  request: Request,
  operation: "git-info-refs" | "git-upload-pack" | "git-receive-pack",
) {
  const repo = gitRepoSlug(
    request.headers.get("x-chief-git-repo")?.trim() ?? "",
  );
  let repository = readGitRepository(storage, repo);
  let refs = readGitRefs(storage, repo);
  if (!repository) {
    // A repository published before the object store existed is rebuilt from
    // its file tree once and persisted, so clones keep working.
    const files = workspaceGitRepositoryFiles(storage, repo);
    if (!files) {
      throw new HttpError(
        404,
        "git_repository_not_found",
        "This workspace Git repository does not exist in the workspace.",
      );
    }
    repository = await buildGitRepository(files);
    writeGitCommit(
      storage,
      repo,
      repository,
      "Publish Eve agent from the workspace",
      "Agent",
    );
    refs = [{ ref: GIT_HEAD_REF, sha: repository.commitSha }];
  }
  return await serveWorkspaceGitHttp({
    repository,
    refs,
    operation,
    service: request.headers.get("x-chief-git-service"),
    body:
      operation === "git-upload-pack"
        ? new Uint8Array(await request.arrayBuffer())
        : undefined,
  });
}

export function workspaceGitRepositoryFiles(
  storage: DurableObjectStorage,
  repo: string,
) {
  const normalized = repo.replace(/\.git$/u, "").toLowerCase();
  const rows = projectsFindWorkspaceGitRepositoryFiles<ProjectRow>(storage);
  const row = rows.find((project) => {
    if (project.provider_id !== "chief-git") return false;
    const remote = project.canonical_remote_url?.replace(/\.git$/u, "") ?? "";
    return remote.split("/").at(-1)?.toLowerCase() === normalized;
  });
  if (!row?.repository_files_json) return undefined;
  return projectRepositoryFilesSchema
    .parse(JSON.parse(row.repository_files_json))
    .map((file) => ({ path: file.path, content: file.content }));
}

export function ensureProjectRepository(
  storage: DurableObjectStorage,
  project: ProjectRow,
) {
  if (!project.canonical_remote_url) return;
  const github = githubRepositoryIdentity(project.canonical_remote_url);
  const provider = github
    ? { id: "github", identity: `${github.owner}/${github.name}` }
    : project.provider_id === "chief-git"
      ? { id: "chief-git", identity: project.project_id }
      : null;
  if (!provider) return;
  projectRepositoriesInsertEnsureProjectRepository(storage, {
    repositoryId: crypto.randomUUID(),
    projectId: project.project_id,
    providerId: provider.id,
    canonicalRemoteUrl: project.canonical_remote_url,
    providerRepositoryId: provider.identity,
    createdAt: project.created_at,
  });
}

export function firstRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}
