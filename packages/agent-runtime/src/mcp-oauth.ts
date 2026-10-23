import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
  OpenIdProviderDiscoveryMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import {
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

/**
 * One MCP OAuth session, independent of where it is stored. The desktop
 * runtime keeps it in local workspace secrets; the relay seals it in the
 * workspace Durable Object. Both drive it through the MCP SDK's `auth()`.
 */
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

export function parseStoredOAuthSession(
  source: string,
): StoredOAuthSession | undefined {
  const value: unknown = JSON.parse(source);
  if (
    !isJsonObject(value) ||
    value.version !== 1 ||
    !isJsonString(value.serverUrl) ||
    !isJsonString(value.state) ||
    !isJsonNumber(value.updatedAt)
  ) {
    return undefined;
  }
  const clientInformation =
    value.clientInformation === undefined
      ? undefined
      : (OAuthClientInformationFullSchema.safeParse(value.clientInformation)
          .data ??
        OAuthClientInformationSchema.safeParse(value.clientInformation).data);
  if (value.clientInformation !== undefined && !clientInformation)
    return undefined;
  const tokens =
    value.tokens === undefined
      ? undefined
      : OAuthTokensSchema.safeParse(value.tokens).data;
  if (value.tokens !== undefined && !tokens) return undefined;
  let discovery: OAuthDiscoveryState | undefined;
  if (value.discovery !== undefined) {
    if (
      !isJsonObject(value.discovery) ||
      !isJsonString(value.discovery.authorizationServerUrl)
    ) {
      return undefined;
    }
    const authorizationServerMetadata =
      value.discovery.authorizationServerMetadata === undefined
        ? undefined
        : (OAuthMetadataSchema.safeParse(
            value.discovery.authorizationServerMetadata,
          ).data ??
          OpenIdProviderDiscoveryMetadataSchema.safeParse(
            value.discovery.authorizationServerMetadata,
          ).data);
    const resourceMetadata =
      value.discovery.resourceMetadata === undefined
        ? undefined
        : OAuthProtectedResourceMetadataSchema.safeParse(
            value.discovery.resourceMetadata,
          ).data;
    if (
      (value.discovery.authorizationServerMetadata !== undefined &&
        !authorizationServerMetadata) ||
      (value.discovery.resourceMetadata !== undefined && !resourceMetadata) ||
      (value.discovery.resourceMetadataUrl !== undefined &&
        !isJsonString(value.discovery.resourceMetadataUrl))
    ) {
      return undefined;
    }
    discovery = {
      authorizationServerUrl: value.discovery.authorizationServerUrl,
      authorizationServerMetadata,
      resourceMetadata,
      resourceMetadataUrl: value.discovery.resourceMetadataUrl,
    };
  }
  if (
    (value.codeVerifier !== undefined && !isJsonString(value.codeVerifier)) ||
    (value.authorizedWithoutTokens !== undefined &&
      !isJsonBoolean(value.authorizedWithoutTokens))
  ) {
    return undefined;
  }
  return {
    version: 1,
    serverUrl: value.serverUrl,
    state: value.state,
    clientInformation,
    tokens,
    codeVerifier: value.codeVerifier,
    discovery,
    authorizedWithoutTokens: value.authorizedWithoutTokens,
    updatedAt: value.updatedAt,
  };
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

/** True when the server offers no way for Chief to register itself. */
export function requiresConfiguredOAuthClient(
  session: StoredOAuthSession,
  hasClientMetadataDocument = false,
): boolean {
  const metadata = session.discovery?.authorizationServerMetadata;
  return Boolean(
    !session.clientInformation &&
    metadata &&
    !metadata.registration_endpoint &&
    !(
      hasClientMetadataDocument &&
      metadata.client_id_metadata_document_supported
    ),
  );
}

export interface McpOAuthProviderOptions {
  redirectUrl: string;
  clientMetadata: OAuthClientMetadata;
  /** A Client ID Metadata Document URL, preferred over dynamic registration. */
  clientMetadataUrl?: string;
  /** Where the authorization URL may point; anything else is refused. */
  allowAuthorizationUrl: (url: URL) => boolean;
  persist: (session: StoredOAuthSession) => Promise<void>;
  /**
   * False for background use (tool calls, refreshes): the provider may
   * refresh tokens but never starts a sign-in, so it cannot disturb one a
   * person has open.
   */
  interactive?: boolean;
}

export class McpOAuthProvider implements OAuthClientProvider {
  private authorizationUrl?: URL;
  readonly clientMetadataUrl?: string;

  constructor(
    private session: StoredOAuthSession,
    private readonly options: McpOAuthProviderOptions,
  ) {
    this.clientMetadataUrl = options.clientMetadataUrl;
  }

  get redirectUrl() {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.options.clientMetadata;
  }

  get current(): StoredOAuthSession {
    return this.session;
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
    if (this.options.interactive === false)
      throw new Error("This connection needs to be signed in again.");
    if (!this.options.allowAuthorizationUrl(url)) {
      throw new Error("OAuth authorization URL must use HTTPS.");
    }
    this.authorizationUrl = url;
  }

  async saveCodeVerifier(codeVerifier: string) {
    if (this.options.interactive === false) return;
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
    await this.options.persist(this.session);
  }
}
