import { z } from "zod";

import { firstRow } from "./workspace-channel-store";

interface ProjectRepositoryRow extends Record<string, SqlStorageValue> {
  repository_id: string;
  project_id: string;
  provider_id: "github" | "chief-git";
  canonical_remote_url: string;
  provider_repository_id: string;
}

export interface ProjectRepository {
  id: string;
  projectId: string;
  provider:
    | { provider: "github"; owner: string; name: string }
    | { provider: "chief-git"; repositoryId: string };
  canonicalRemoteUrl: string;
}

export type ProjectRepositoryResolution =
  | {
      status: "verified";
      resolvedCommitSha: string;
      contentDigest: string;
    }
  | { status: "unresolved"; reason: string };

export interface ProjectRepositoryAdapter {
  resolve(
    repository: ProjectRepository,
    path: string,
    requestedRef: string,
  ): Promise<ProjectRepositoryResolution>;
}

export interface GitHubInstallationTokenProvider {
  installationToken(repository: ProjectRepository): Promise<string | undefined>;
}

export function projectRepository(
  storage: DurableObjectStorage,
  projectId: string,
): ProjectRepository | undefined {
  const row = firstRow<ProjectRepositoryRow>(
    storage.sql.exec(
      "SELECT * FROM project_repositories WHERE project_id = ?",
      projectId,
    ),
  );
  if (!row) return undefined;
  return {
    id: row.repository_id,
    projectId: row.project_id,
    provider:
      row.provider_id === "github"
        ? parseGitHubIdentity(row.provider_repository_id)
        : {
            provider: "chief-git",
            repositoryId: row.provider_repository_id,
          },
    canonicalRemoteUrl: row.canonical_remote_url,
  };
}

export class ProjectRepositoryResolver {
  constructor(private readonly github = new GitHubProjectRepository()) {}

  resolve(repository: ProjectRepository, path: string, requestedRef: string) {
    if (repository.provider.provider === "github")
      return this.github.resolve(repository, path, requestedRef);
    return Promise.resolve({
      status: "unresolved" as const,
      reason:
        "This Chief Git repository is not materialized on this relay yet.",
    });
  }
}

export class GitHubProjectRepository implements ProjectRepositoryAdapter {
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly credentials?: GitHubInstallationTokenProvider,
  ) {}

  async resolve(
    repository: ProjectRepository,
    path: string,
    requestedRef: string,
  ): Promise<ProjectRepositoryResolution> {
    if (repository.provider.provider !== "github")
      throw new TypeError("Expected a GitHub repository.");
    const token = await this.credentials?.installationToken(repository);
    if (!token)
      return {
        status: "unresolved",
        reason:
          "Connect this repository through the relay's GitHub App before Chief verifies its definition.",
      };
    const { owner, name } = repository.provider;
    const commit = await this.github(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(requestedRef)}`,
      githubCommitSchema,
      token,
    );
    if (!commit.ok) return commit.resolution;
    const tree = await this.github(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${commit.value.sha}?recursive=1`,
      githubTreeSchema,
      token,
    );
    if (!tree.ok) return tree.resolution;
    if (tree.value.truncated)
      return {
        status: "unresolved",
        reason:
          "GitHub truncated the repository tree before Chief could verify the definition.",
      };
    const normalizedPath = path.replace(/\/$/u, "");
    const entries = tree.value.tree
      .filter(
        (entry) =>
          entry.path === normalizedPath ||
          entry.path.startsWith(`${normalizedPath}/`),
      )
      .map(({ path: entryPath, mode, type, sha }) => ({
        path: entryPath,
        mode,
        type,
        sha,
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    if (entries.length === 0)
      return {
        status: "unresolved",
        reason:
          "The agent definition path does not exist at the requested revision.",
      };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(entries)),
    );
    return {
      status: "verified",
      resolvedCommitSha: commit.value.sha,
      contentDigest: `sha256:${[...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")}`,
    };
  }

  private async github<T>(
    pathname: string,
    schema: z.ZodType<T>,
    installationToken: string,
  ) {
    const response = await this.request(`https://api.github.com${pathname}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${installationToken}`,
        "user-agent": "Chief-Relay",
        "x-github-api-version": "2026-03-10",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ok: false as const,
        resolution: {
          status: "unresolved" as const,
          reason:
            response.status === 404
              ? "GitHub could not read this repository or revision. Connect a GitHub App for private repositories."
              : `GitHub revision verification returned HTTP ${response.status}.`,
        },
      };
    }
    return { ok: true as const, value: schema.parse(await response.json()) };
  }
}

export function githubRepositoryIdentity(remote: string) {
  const url = new URL(remote);
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  const parts = url.pathname
    .replace(/^\//u, "")
    .replace(/\.git$/u, "")
    .split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { provider: "github" as const, owner: parts[0], name: parts[1] };
}

function parseGitHubIdentity(value: string) {
  const [owner, name, extra] = value.split("/");
  if (!owner || !name || extra)
    throw new Error("Invalid GitHub repository identity.");
  return { provider: "github" as const, owner, name };
}

const githubCommitSchema = z.object({
  sha: z.string().regex(/^[a-f\d]{40}$/iu),
});
const githubTreeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.enum(["blob", "tree", "commit"]),
      sha: z.string().regex(/^[a-f\d]{40}$/iu),
    }),
  ),
});
