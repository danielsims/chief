import { z } from "zod";

import { HttpError } from "./http";

/** Credentials for the GitHub App a workspace's repositories are reached through. */
export interface GitHubAppCredentials {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
}

export const githubAppCredentialsSchema = z.object({
  appId: z.string().min(1),
  slug: z.string().min(1),
  privateKey: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

/** The relay's own app, configured as Worker secrets (the hosted relay ships one). */
export function relayGitHubApp(env: Env): GitHubAppCredentials | null {
  const {
    GITHUB_APP_ID,
    GITHUB_APP_SLUG,
    GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET,
  } = env;
  if (
    !GITHUB_APP_ID ||
    !GITHUB_APP_SLUG ||
    !GITHUB_APP_PRIVATE_KEY ||
    !GITHUB_APP_CLIENT_ID ||
    !GITHUB_APP_CLIENT_SECRET
  ) {
    return null;
  }
  return {
    appId: GITHUB_APP_ID,
    slug: GITHUB_APP_SLUG,
    privateKey: GITHUB_APP_PRIVATE_KEY,
    clientId: GITHUB_APP_CLIENT_ID,
    clientSecret: GITHUB_APP_CLIENT_SECRET,
  };
}

export class GitHubApi {
  constructor(private readonly request: typeof fetch = fetch) {}

  /** Exchanges a manifest code for the credentials of the app GitHub just created. */
  async convertManifest(code: string): Promise<GitHubAppCredentials> {
    const created = await this.call(
      `/app-manifests/${encodeURIComponent(code)}/conversions`,
      manifestConversionSchema,
      { method: "POST" },
    );
    return {
      appId: String(created.id),
      slug: created.slug,
      privateKey: created.pem,
      clientId: created.client_id,
      clientSecret: created.client_secret,
    };
  }

  /** Exchanges an installation-time OAuth code for the installing person's token. */
  async userToken(app: GitHubAppCredentials, code: string) {
    const response = await this.request(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "Chief-Relay",
        },
        body: JSON.stringify({
          client_id: app.clientId,
          client_secret: app.clientSecret,
          code,
        }),
      },
    );
    const parsed = oauthTokenSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success || !parsed.data.access_token) {
      throw new HttpError(
        400,
        "github_authorization_failed",
        "GitHub didn't confirm who installed the app. Try connecting again.",
      );
    }
    return parsed.data.access_token;
  }

  /** Whether the person behind `userToken` can access this installation. */
  async userCanAccessInstallation(userToken: string, installationId: number) {
    for (let page = 1; page <= 10; page += 1) {
      const result = await this.call(
        `/user/installations?per_page=100&page=${page}`,
        userInstallationsSchema,
        {},
        userToken,
      );
      if (
        result.installations.some(
          (installation) => installation.id === installationId,
        )
      ) {
        return true;
      }
      if (result.installations.length < 100) return false;
    }
    return false;
  }

  async installation(app: GitHubAppCredentials, installationId: number) {
    const installation = await this.call(
      `/app/installations/${installationId}`,
      installationSchema,
      {},
      await appJwt(app),
    );
    return {
      id: installation.id,
      account: installation.account.login,
      avatarUrl: installation.account.avatar_url,
    };
  }

  /** The installation a repository is reachable through, if any. */
  async repositoryInstallation(
    app: GitHubAppCredentials,
    owner: string,
    name: string,
  ) {
    const response = await this.request(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/installation`,
      { headers: headers(await appJwt(app)) },
    );
    if (response.status === 404) return null;
    const parsed = installationSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success) {
      throw new HttpError(
        502,
        "github_request_failed",
        "GitHub didn't respond as expected. Try again.",
      );
    }
    return parsed.data.id;
  }

  async installationToken(
    app: GitHubAppCredentials,
    installationId: number,
    scope: {
      repositories?: string[];
      permissions: Record<string, "read" | "write">;
    },
  ) {
    const token = await this.call(
      `/app/installations/${installationId}/access_tokens`,
      accessTokenSchema,
      {
        method: "POST",
        body: JSON.stringify(scope),
      },
      await appJwt(app),
    );
    return { token: token.token, expiresAt: token.expires_at };
  }

  async installationRepositories(installationToken: string) {
    const repositories: z.infer<typeof repositorySchema>[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const result = await this.call(
        `/installation/repositories?per_page=100&page=${page}`,
        repositoryListSchema,
        {},
        installationToken,
      );
      repositories.push(...result.repositories);
      if (result.repositories.length < 100) break;
    }
    return repositories.map((repository) => ({
      id: repository.id,
      fullName: repository.full_name,
      owner: repository.owner.login,
      name: repository.name,
      private: repository.private,
      defaultBranch: repository.default_branch,
      cloneUrl: repository.clone_url,
      updatedAt: repository.pushed_at ?? undefined,
    }));
  }

  private async call<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit,
    token?: string,
  ): Promise<T> {
    const response = await this.request(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        ...headers(token),
        ...(init.body ? { "content-type": "application/json" } : undefined),
      },
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!response.ok || !parsed.success) {
      throw new HttpError(
        response.status === 404 ? 404 : 502,
        "github_request_failed",
        "GitHub didn't respond as expected. Try again.",
      );
    }
    return parsed.data;
  }
}

function headers(token?: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "Chief-Relay",
    "x-github-api-version": API_VERSION,
    ...(token ? { authorization: `Bearer ${token}` } : undefined),
  };
}

/** A ten-minute JWT that authenticates as the app itself. */
export async function appJwt(app: GitHubAppCredentials, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  const encode = (value: Record<string, string | number>) =>
    base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    // Backdated to tolerate clock drift between the relay and GitHub.
    iat: seconds - 60,
    exp: seconds + 9 * 60,
    iss: app.clientId,
  })}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8FromPem(app.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

/** GitHub issues PKCS#1 keys; WebCrypto needs PKCS#8, so wrap them. */
export function pkcs8FromPem(pem: string) {
  const body = pem.replace(/-----[^-]+-----/gu, "").replace(/\s+/gu, "");
  const der = Uint8Array.from(atob(body), (character) =>
    character.charCodeAt(0),
  );
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) return der.buffer;
  const rsaAlgorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];
  const content = [
    0x02,
    0x01,
    0x00,
    ...rsaAlgorithm,
    0x04,
    ...derLength(der.length),
    ...der,
  ];
  return new Uint8Array([0x30, ...derLength(content.length), ...content])
    .buffer;
}

function derLength(length: number) {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>= 8) bytes.unshift(value & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/=+$/u, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}

const manifestConversionSchema = z.object({
  id: z.number(),
  slug: z.string(),
  pem: z.string(),
  client_id: z.string(),
  client_secret: z.string(),
});

const oauthTokenSchema = z.object({ access_token: z.string().optional() });

const installationSchema = z.object({
  id: z.number(),
  account: z.object({
    login: z.string(),
    avatar_url: z.string().url().optional(),
  }),
});

const userInstallationsSchema = z.object({
  installations: z.array(z.object({ id: z.number() })),
});

const accessTokenSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
});

const repositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  private: z.boolean(),
  default_branch: z.string(),
  clone_url: z.string().url(),
  pushed_at: z.string().nullable().optional(),
});

const repositoryListSchema = z.object({
  repositories: z.array(repositorySchema),
});
