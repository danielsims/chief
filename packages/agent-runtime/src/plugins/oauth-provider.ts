import { timingSafeEqual } from "node:crypto";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { isJsonNumber } from "@chief/relay-contracts";

import { workspaceSecrets } from "../workspace-secrets.js";

export const PLUGIN_OAUTH_CALLBACK_URL =
  "http://127.0.0.1:4318/plugins/oauth/callback";

export interface StoredOAuthSession {
  version: 1;
  serverUrl: string;
  state: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discovery?: OAuthDiscoveryState;
  authorizedWithoutTokens?: boolean;
  updatedAt: number;
}

function secretName(pluginId: string, serverName: string) {
  const safe = `${pluginId}-${serverName}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return `plugin-oauth-${safe}.json`;
}

export async function readOAuthSession(
  workspaceId: string,
  pluginId: string,
  serverName: string,
): Promise<StoredOAuthSession | undefined> {
  try {
    const value = await workspaceSecrets.readPrivate(
      workspaceId,
      secretName(pluginId, serverName),
    );
    return value ? (JSON.parse(value) as StoredOAuthSession) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeOAuthSession(
  workspaceId: string,
  pluginId: string,
  serverName: string,
  session: StoredOAuthSession,
) {
  await workspaceSecrets.storePrivate(
    workspaceId,
    secretName(pluginId, serverName),
    JSON.stringify(session),
  );
}

export function deleteOAuthSession(
  workspaceId: string,
  pluginId: string,
  serverName: string,
) {
  return workspaceSecrets.deletePrivate(
    workspaceId,
    secretName(pluginId, serverName),
  );
}

export function oauthStateMatches(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function accessTokenExpired(session: StoredOAuthSession) {
  return (
    isJsonNumber(session.tokens?.expires_in) &&
    session.updatedAt + session.tokens.expires_in * 1000 <= Date.now() + 30_000
  );
}

export function oauthSessionConnected(session: StoredOAuthSession | undefined) {
  const hasAuthorization = [
    session?.authorizedWithoutTokens,
    session?.tokens?.access_token,
  ].some(Boolean);
  return Boolean(session && !accessTokenExpired(session) && hasAuthorization);
}

export function oauthConnectionStatus(
  sessions: readonly (StoredOAuthSession | undefined)[],
): "authorization_required" | "reconnect" | "connected" {
  const present = sessions.filter((session): session is StoredOAuthSession =>
    Boolean(session),
  );
  if (present.length !== sessions.length) return "authorization_required";
  if (present.some(accessTokenExpired)) {
    return "reconnect";
  }
  return present.every(oauthSessionConnected)
    ? "connected"
    : "authorization_required";
}

export class ChiefOAuthProvider implements OAuthClientProvider {
  private authorizationUrl?: URL;

  constructor(
    private readonly workspaceId: string,
    private readonly pluginId: string,
    private readonly serverName: string,
    private session: StoredOAuthSession,
  ) {}

  get redirectUrl() {
    return PLUGIN_OAUTH_CALLBACK_URL;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Chief",
      client_uri: "https://github.com/latent-supply/chief",
      redirect_uris: [PLUGIN_OAUTH_CALLBACK_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  state() {
    return this.session.state;
  }

  clientInformation() {
    return this.session.clientInformation;
  }

  async saveClientInformation(value: OAuthClientInformationMixed) {
    this.session.clientInformation = value;
    await this.persist();
  }

  tokens() {
    return this.session.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.session.tokens = tokens;
    await this.persist();
  }

  redirectToAuthorization(url: URL) {
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1") {
      throw new Error("OAuth authorization URL must use HTTPS.");
    }
    this.authorizationUrl = url;
  }

  async saveCodeVerifier(codeVerifier: string) {
    this.session.codeVerifier = codeVerifier;
    await this.persist();
  }

  codeVerifier() {
    if (!this.session.codeVerifier)
      throw new Error("OAuth code verifier is missing.");
    return this.session.codeVerifier;
  }

  async saveDiscoveryState(discovery: OAuthDiscoveryState) {
    this.session.discovery = discovery;
    await this.persist();
  }

  discoveryState() {
    return this.session.discovery;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ) {
    if (scope === "all" || scope === "client")
      delete this.session.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.session.tokens;
    if (scope === "all" || scope === "verifier")
      delete this.session.codeVerifier;
    if (scope === "all" || scope === "discovery") delete this.session.discovery;
    await this.persist();
  }

  takeAuthorizationUrl() {
    return this.authorizationUrl;
  }

  private async persist() {
    this.session.updatedAt = Date.now();
    await writeOAuthSession(
      this.workspaceId,
      this.pluginId,
      this.serverName,
      this.session,
    );
  }
}
