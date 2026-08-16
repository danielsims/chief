import { createSign, randomUUID } from "node:crypto";

export interface GitHubAppCredentials {
  appId: string;
  privateKey: string;
}

export interface GitHubAppToken {
  token: string;
  expiresAt: number;
}

function base64Url(value: Buffer) {
  return value
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload: Record<string, number | string>, privateKey: string) {
  const header = base64Url(
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const body = base64Url(Buffer.from(JSON.stringify(payload)));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${body}`);
  const signature = base64Url(signer.sign(privateKey));
  return `${header}.${body}.${signature}`;
}

/**
 * Mints a short-lived GitHub App installation token from the app's private
 * key. The private key never leaves the trusted host; only the token result is
 * returned, scoped to one installation and expiring quickly.
 */
export class GitHubApp {
  constructor(
    private readonly credentials: GitHubAppCredentials,
    private readonly apiBaseUrl = "https://api.github.com",
    private readonly now: () => number = Date.now,
  ) {}

  async installationToken(installationId: string): Promise<GitHubAppToken> {
    const now = this.now();
    const appToken = signJwt(
      {
        iss: this.credentials.appId,
        iat: Math.floor(now / 1_000) - 60,
        exp: Math.floor(now / 1_000) + 9 * 60,
      },
      this.credentials.privateKey,
    );
    const response = await fetch(
      `${this.apiBaseUrl}/app/installations/${encodeURIComponent(
        installationId,
      )}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "chief",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    const body = (await response.json().catch(() => null)) as {
      token?: string;
      expires_at?: string;
      message?: string;
    } | null;
    if (!response.ok || !body?.token) {
      throw new Error(
        `GitHub could not mint an installation token: ${body?.message ?? response.status}`,
      );
    }
    return {
      token: body.token,
      expiresAt: body.expires_at
        ? Date.parse(body.expires_at)
        : now + 60 * 60_000,
    };
  }

  /** Returns a stable opaque reference for a freshly installed app. */
  static secretReference() {
    return `github-app:${randomUUID()}`;
  }
}
