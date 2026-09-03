import { projectRepositoryFilesSchema } from "@chief/relay-contracts";

import { serveChiefGitHttp } from "./chief-git-http";
import { HttpError } from "./http";
import { githubRepositoryIdentity } from "./project-repository";

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
  const repo = request.headers.get("x-chief-git-repo")?.trim() ?? "";
  const files = chiefGitRepositoryFiles(storage, repo);
  if (!files && operation !== "git-receive-pack") {
    throw new HttpError(
      404,
      "git_repository_not_found",
      "This Chief Git repository does not exist in the workspace.",
    );
  }
  return await serveChiefGitHttp({
    files: files ?? [],
    operation,
    service: request.headers.get("x-chief-git-service"),
    body:
      operation === "git-upload-pack"
        ? new Uint8Array(await request.arrayBuffer())
        : undefined,
  });
}

export function chiefGitRepositoryFiles(
  storage: DurableObjectStorage,
  repo: string,
) {
  const normalized = repo.replace(/\.git$/u, "").toLowerCase();
  const rows = storage.sql.exec<ProjectRow>("SELECT * FROM projects").toArray();
  const row = rows.find((project) => {
    const remote = project.canonical_remote_url?.replace(/\.git$/u, "") ?? "";
    const identity = remote.split("/").at(-1)?.toLowerCase();
    const name = project.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return identity === normalized || name === normalized;
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
  storage.sql.exec(
    `INSERT OR IGNORE INTO project_repositories (
      repository_id, project_id, provider_id, canonical_remote_url,
      provider_repository_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    project.project_id,
    provider.id,
    project.canonical_remote_url,
    provider.identity,
    project.created_at,
  );
}

export function normalizeProjectOwner(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export function firstRow<T>(cursor: Iterable<T>): T | undefined {
  const next = cursor[Symbol.iterator]().next();
  return next.done ? undefined : next.value;
}
