import { z } from "zod";

import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

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

const jsonObjectSchema = z.record(z.string(), z.unknown());
const repositoryListSchema = z.object({
  repositories: z.array(jsonObjectSchema).optional(),
  total_count: z.number().optional(),
});
const checkRunsSchema = z.object({
  check_runs: z.array(jsonObjectSchema).optional(),
});

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
  return isJsonString(value) ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  return isJsonNumber(value) ? value : fallback;
}

function asDate(value: unknown) {
  return isJsonString(value) ? Date.parse(value) : Date.now();
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
    const body = repositoryListSchema.parse(
      await this.api(`installation/repositories?${params}`, connectionId),
    );
    const repositories = (body.repositories ?? []).map((row) =>
      this.repository(row),
    );
    const total = Number(body.total_count ?? repositories.length);
    const nextCursor =
      repositories.length > 0 &&
      (Number(cursor ?? 1) * 100 < total || total === 0)
        ? String(Number(cursor ?? 1) + 1)
        : undefined;
    return { repositories, ...(nextCursor ? { nextCursor } : undefined) };
  }

  async getRepository(connectionId: string, repositoryId: string) {
    const parsed = parseOwnerName(repositoryId);
    if (!parsed) throw new Error("Use a repository id like owner/name.");
    const body = await this.api(
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
    const body = await this.api(
      `repos/${parsed.owner}/${parsed.name}/pulls`,
      connectionId,
      {
        method: "POST",
        body: {
          title: input.title,
          ...(input.description ? { body: input.description } : undefined),
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
    const body = await this.api(
      `repos/${parsed.owner}/${parsed.name}/pulls/${input.number}`,
      connectionId,
      {
        method: "PATCH",
        body: {
          ...(input.title ? { title: input.title } : undefined),
          ...(input.description ? { body: input.description } : undefined),
          ...(input.state ? { state: input.state } : undefined),
        },
      },
    );
    return this.pullRequest(body);
  }

  async getChecks(input: ProviderRefInput): Promise<ProviderCheckSummary[]> {
    const parsed = parseOwnerName(input.repositoryId);
    if (!parsed) throw new Error("Use a repository id like owner/name.");
    const body = checkRunsSchema.parse(
      await this.api(
        `repos/${parsed.owner}/${parsed.name}/commits/${encodeURIComponent(
          input.ref,
        )}/check-runs?per_page=100`,
      ),
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
        : undefined),
      ...(row.started_at ? { startedAt: asDate(row.started_at) } : undefined),
      ...(row.completed_at
        ? { completedAt: asDate(row.completed_at) }
        : undefined),
      ...(row.html_url ? { url: asString(row.html_url, "") } : undefined),
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
      row.owner && isJsonObject(row.owner)
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
        : undefined),
      ...(row.owner && isJsonObject(row.owner)
        ? { avatarUrl: asString((row.owner as Json).avatar_url, "") }
        : undefined),
      cloneUrl: asString(row.clone_url, `https://github.com/${fullName}.git`),
      ...(row.html_url ? { webUrl: asString(row.html_url, "") } : undefined),
    };
  }

  private pullRequest(row: Json): ProviderPullRequest {
    const merged = row.merged_at !== undefined && row.merged_at !== null;
    return {
      number: asNumber(row.number, 0),
      title: asString(row.title, ""),
      ...(row.body ? { description: asString(row.body, "") } : undefined),
      state: merged ? "merged" : row.state === "open" ? "open" : "closed",
      headBranch: asString(
        row.head && isJsonObject(row.head) ? (row.head as Json).ref : undefined,
        "",
      ),
      baseBranch: asString(
        row.base && isJsonObject(row.base) ? (row.base as Json).ref : undefined,
        "",
      ),
      ...(row.html_url ? { url: asString(row.html_url, "") } : undefined),
      createdAt: row.created_at ? asDate(row.created_at) : Date.now(),
      updatedAt: row.updated_at ? asDate(row.updated_at) : Date.now(),
    };
  }

  private async api(
    path: string,
    connectionId?: string,
    options?: { method?: string; body?: Json },
  ): Promise<Json> {
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
        ...(options?.body ? { body: JSON.stringify(options.body) } : undefined),
      },
    );
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    const body = jsonObjectSchema.parse(parsed);
    if (
      response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0"
    ) {
      throw new Error("GitHub rate limit exceeded. Try again later.");
    }
    if (!response.ok) {
      const message =
        body.message ??
        body.documentation_url ??
        `GitHub returned ${response.status}`;
      throw new Error(
        redactUrlCredentials(
          isJsonString(message) ? message : "GitHub rejected the request.",
        ),
      );
    }
    return body;
  }
}
