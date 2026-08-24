import type {
  CredentialRequest,
  ProjectProviderAdapter,
  ProviderCheckConclusion,
  ProviderCheckSummary,
  ProviderPullRequest,
  ProviderPullRequestInput,
  ProviderPullRequestUpdate,
  ProviderRefInput,
  ProviderRepository,
  ProviderRepositoryIdentity,
  ShortLivedCredential,
} from "../project-types.js";
import { redactUrlCredentials } from "./credential-broker.js";
import { GitHubApp } from "./github-app.js";

type Json = Record<string, unknown>;

interface GitHubAdapterOptions {
  appId?: string;
  privateKey?: string;
  installationId?: string;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  token?: string;
}

function parseOwnerName(repositoryId: string) {
  const [owner, ...rest] = repositoryId.trim().split("/");
  const name = rest.join("/");
  if (!owner || !name) return undefined;
  return { owner, name };
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function asDate(value: unknown) {
  return typeof value === "string" ? Date.parse(value) : Date.now();
}

function asBoolean(value: unknown) {
  return value === true || value === "true";
}

/**
 * First-class GitHub integration through a GitHub App installation. All
 * operations use short-lived installation tokens minted by the trusted host;
 * no personal token is ever stored, and nothing here is shown to the model.
 */
export class GitHubProjectProviderAdapter implements ProjectProviderAdapter {
  readonly id = "github" as const;
  private readonly app: GitHubApp | undefined;
  private readonly installationId: string | undefined;
  private readonly configuredToken: string | undefined;
  private readonly apiBaseUrl: string;
  private readonly request: typeof fetch;

  constructor(options: GitHubAdapterOptions = {}) {
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
    this.request = options.fetch ?? fetch;
    this.installationId = options.installationId;
    this.configuredToken = options.token;
    if (options.appId && options.privateKey) {
      this.app = new GitHubApp(
        { appId: options.appId, privateKey: options.privateKey },
        this.apiBaseUrl,
      );
    }
  }

  resolveRemote(input: string): ProviderRepositoryIdentity | undefined {
    const trimmed = input.trim();
    let path = "";
    let host = "";
    const scp = /^git@([\w.-]+):(.+)$/.exec(trimmed);
    if (scp) {
      host = scp[1]?.toLowerCase() ?? "";
      path = scp[2] ?? "";
    } else {
      try {
        const url = new URL(trimmed);
        if (url.hostname.toLowerCase() !== "github.com") return undefined;
        host = url.hostname.toLowerCase();
        path = url.pathname;
      } catch {
        return undefined;
      }
    }
    if (host !== "github.com") return undefined;
    const repositoryId = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    const [owner, name] = repositoryId.split("/");
    if (!owner || !name || name.includes("/")) return undefined;
    return {
      providerId: "github",
      repositoryId: `${owner}/${name}`,
      cloneUrl: `https://github.com/${owner}/${name}.git`,
      webUrl: `https://github.com/${owner}/${name}`,
    };
  }

  async listRepositories(
    connectionId: string,
    query?: string,
    cursor?: string,
  ) {
    const params = new URLSearchParams({ per_page: "100" });
    if (query?.trim()) params.set("q", `fork:true ${query.trim()}`);
    if (cursor) params.set("page", cursor);
    const body = await this.api<{
      repositories?: Json[];
      total_count?: number;
    }>(`installation/repositories?${params}`, connectionId);
    const repositories = (body.repositories ?? []).map((row) =>
      this.repository(row),
    );
    const total = Number(body.total_count ?? repositories.length);
    const nextCursor =
      repositories.length > 0 &&
      (Number(cursor ?? 1) * 100 < total || total === 0)
        ? String(Number(cursor ?? 1) + 1)
        : undefined;
    return { repositories, ...(nextCursor ? { nextCursor } : {}) };
  }

  async getRepository(connectionId: string, repositoryId: string) {
    const parsed = parseOwnerName(repositoryId);
    if (!parsed) throw new Error("Use a repository id like owner/name.");
    const body = await this.api<Json>(
      `repos/${parsed.owner}/${parsed.name}`,
      connectionId,
    );
    return this.repository(body);
  }

  async createGitCredential(
    _input: CredentialRequest,
  ): Promise<ShortLivedCredential> {
    const token = await this.accessToken();
    return {
      username: "x-access-token",
      password: token.token,
      expiresAt: token.expiresAt || undefined,
    };
  }

  async createPullRequest(
    connectionId: string,
    input: ProviderPullRequestInput,
  ) {
    const parsed = parseOwnerName(input.repositoryId);
    if (!parsed) throw new Error("Use a repository id like owner/name.");
    const body = await this.api<Json>(
      `repos/${parsed.owner}/${parsed.name}/pulls`,
      connectionId,
      {
        method: "POST",
        body: {
          title: input.title,
          ...(input.description ? { body: input.description } : {}),
          head: input.headBranch,
          base: input.baseBranch,
        },
      },
    );
    return this.pullRequest(body);
  }

  async updatePullRequest(
    connectionId: string,
    input: ProviderPullRequestUpdate,
  ) {
    const parsed = parseOwnerName(input.repositoryId);
    if (!parsed) throw new Error("Use a repository id like owner/name.");
    const body = await this.api<Json>(
      `repos/${parsed.owner}/${parsed.name}/pulls/${input.number}`,
      connectionId,
      {
        method: "PATCH",
        body: {
          ...(input.title ? { title: input.title } : {}),
          ...(input.description ? { body: input.description } : {}),
          ...(input.state ? { state: input.state } : {}),
        },
      },
    );
    return this.pullRequest(body);
  }

  async getChecks(input: ProviderRefInput): Promise<ProviderCheckSummary[]> {
    const parsed = parseOwnerName(input.repositoryId);
    if (!parsed) throw new Error("Use a repository id like owner/name.");
    const body = await this.api<{ check_runs?: Json[] }>(
      `repos/${parsed.owner}/${parsed.name}/commits/${encodeURIComponent(
        input.ref,
      )}/check-runs?per_page=100`,
    );
    return (body.check_runs ?? []).map((row) => ({
      name: asString(row.name, "check"),
      status: asString(row.status, "queued") as ProviderCheckSummary["status"],
      ...(row.conclusion
        ? {
            conclusion: asString(
              row.conclusion,
              "success",
            ) as ProviderCheckConclusion,
          }
        : {}),
      ...(row.started_at ? { startedAt: asDate(row.started_at) } : {}),
      ...(row.completed_at ? { completedAt: asDate(row.completed_at) } : {}),
      ...(row.html_url ? { url: asString(row.html_url, "") } : {}),
    }));
  }

  private async accessToken() {
    if (this.app && this.installationId) {
      return this.app.installationToken(this.installationId);
    }
    if (this.configuredToken) {
      return { token: this.configuredToken, expiresAt: 0 };
    }
    throw new Error(
      "This workspace has no active GitHub connection to perform the operation.",
    );
  }

  private repository(row: Json): ProviderRepository {
    const owner = asString(
      row.owner && typeof row.owner === "object"
        ? (row.owner as Json).login
        : undefined,
      "",
    );
    const name = asString(row.name, "");
    const fullName = asString(row.full_name, `${owner}/${name}`);
    const [ownerName, repoName] = fullName.split("/");
    return {
      id: fullName,
      owner: ownerName ?? owner,
      name: repoName ?? name,
      defaultBranch: asString(row.default_branch, "main"),
      private: asBoolean(row.private),
      ...(row.description
        ? { description: asString(row.description, "") }
        : {}),
      ...(row.owner && typeof row.owner === "object"
        ? { avatarUrl: asString((row.owner as Json).avatar_url, "") }
        : {}),
      cloneUrl: asString(row.clone_url, `https://github.com/${fullName}.git`),
      ...(row.html_url ? { webUrl: asString(row.html_url, "") } : {}),
    };
  }

  private pullRequest(row: Json): ProviderPullRequest {
    const merged = row.merged_at !== undefined && row.merged_at !== null;
    return {
      number: asNumber(row.number, 0),
      title: asString(row.title, ""),
      ...(row.body ? { description: asString(row.body, "") } : {}),
      state: merged ? "merged" : row.state === "open" ? "open" : "closed",
      headBranch: asString(
        row.head && typeof row.head === "object"
          ? (row.head as Json).ref
          : undefined,
        "",
      ),
      baseBranch: asString(
        row.base && typeof row.base === "object"
          ? (row.base as Json).ref
          : undefined,
        "",
      ),
      ...(row.html_url ? { url: asString(row.html_url, "") } : {}),
      createdAt: row.created_at ? asDate(row.created_at) : Date.now(),
      updatedAt: row.updated_at ? asDate(row.updated_at) : Date.now(),
    };
  }

  private async api<T>(
    path: string,
    connectionId?: string,
    options?: { method?: string; body?: Json },
  ): Promise<T> {
    const token = await this.accessToken();
    const response = await this.request(
      `${this.apiBaseUrl}/${path.replace(/^\/+/, "")}`,
      {
        method: options?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token.token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "chief",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
      },
    );
    const text = await response.text();
    const body = text ? (JSON.parse(text) as T) : ({} as T);
    if (
      response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0"
    ) {
      throw new Error("GitHub rate limit exceeded. Try again later.");
    }
    if (!response.ok) {
      const message =
        (body as Json).message ??
        (body as Json).documentation_url ??
        `GitHub returned ${response.status}`;
      throw new Error(
        redactUrlCredentials(
          typeof message === "string"
            ? message
            : "GitHub rejected the request.",
        ),
      );
    }
    return body;
  }
}
