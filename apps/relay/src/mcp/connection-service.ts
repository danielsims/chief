import type { z } from "zod";
import {
  auth,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";

import type { StoredOAuthSession } from "@chief/agent-runtime/mcp-oauth";
import type {
  McpConnection,
  McpConnectionAuthorizeResult,
  mcpConnectionClientSchema,
  McpConnectionCreate,
  McpToolCall,
  McpToolCallResult,
  Principal,
} from "@chief/relay-contracts";
import {
  accessTokenExpired,
  McpOAuthProvider,
  requiresConfiguredOAuthClient,
} from "@chief/agent-runtime/mcp-oauth";
import {
  mcpConnectionIdSchema,
  mcpConnectionSchema,
} from "@chief/relay-contracts";

import type { McpServerAccess } from "./client";
import type { McpCredential } from "./credentials";
import { relayOrigin } from "../hosted-project-checkout";
import { HttpError } from "../http";
import { mcpConnectionsDeleteConnection } from "../queries/mcp-connections/delete-connection";
import { mcpConnectionsDeleteOAuthRequest } from "../queries/mcp-connections/delete-oauth-request";
import { mcpConnectionsFindConnection } from "../queries/mcp-connections/find-connection";
import { mcpConnectionsFindConnections } from "../queries/mcp-connections/find-connections";
import { mcpConnectionsFindOAuthRequest } from "../queries/mcp-connections/find-oauth-request";
import { mcpConnectionsInsertOAuthRequest } from "../queries/mcp-connections/insert-oauth-request";
import { mcpConnectionsUpdateOAuthBinding } from "../queries/mcp-connections/update-oauth-binding";
import { mcpConnectionsUpsertConnection } from "../queries/mcp-connections/upsert-connection";
import { workspaceFindAuthorize } from "../queries/workspace/find-authorize";
import { requireWorkspaceAdministrator } from "../workspace-administration";
import { WorkspaceChannelStore } from "../workspace-channel-store";
import { callMcpTool, listMcpTools } from "./client";
import { unlinkConnection } from "./connection-cleanup";
import { McpCredentialStore } from "./credentials";
import {
  guardedMcpFetch,
  McpFetchError,
  requirePublicMcpUrl,
} from "./fetch-guard";
import {
  oneAtATime,
  optionalMetadata,
  requireConsistentIssuer,
  revokeSession,
} from "./oauth-policy";
import {
  MCP_OAUTH_START_PATH,
  mcpClientMetadata,
  randomToken,
  sameDigest,
  sha256,
  workspaceSignInTag,
} from "./oauth-support";

const maximumConnections = 100;
const signInLifetimeMs = 5 * 60_000;
const toolListFreshMs = 15 * 60_000;

// Headers the transport owns or that could change how the request is routed.
const reservedHeader =
  /^(host|cookie|connection|keep-alive|content-|transfer-encoding|upgrade|te|trailer|proxy-|forwarded|x-forwarded-|mcp-session-id|mcp-protocol-version|last-event-id)/iu;

/** Never let a provider's error text (which may echo request data) through. */
function parseFailureMessage(error: unknown) {
  if (error instanceof HttpError || error instanceof McpFetchError)
    return error.message;
  if (error instanceof UnauthorizedError)
    return "The plugin needs to be connected again.";
  return "Chief could not reach this plugin.";
}

export class McpConnectionService {
  private readonly channels: WorkspaceChannelStore;
  private readonly credentials: McpCredentialStore;
  private readonly origin: string;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: Env,
    private readonly workspaceId: string,
  ) {
    this.channels = new WorkspaceChannelStore(storage, env);
    this.credentials = new McpCredentialStore(
      storage,
      env.RELAY_SECRET_KEY,
      workspaceId,
    );
    this.origin = relayOrigin(env);
  }

  list(): McpConnection[] {
    return mcpConnectionsFindConnections(this.storage).map((row) =>
      mcpConnectionSchema.parse(JSON.parse(row.document_json)),
    );
  }

  read(id: string): McpConnection {
    const row = mcpConnectionsFindConnection(
      this.storage,
      mcpConnectionIdSchema.parse(id),
    );
    if (!row)
      throw new HttpError(
        404,
        "plugin_not_found",
        "This plugin is not connected.",
      );
    return mcpConnectionSchema.parse(JSON.parse(row.document_json));
  }

  private insert(connection: McpConnection) {
    const next = mcpConnectionSchema.parse({
      ...connection,
      updatedAt: Date.now(),
    });
    mcpConnectionsUpsertConnection(this.storage, {
      id: next.id,
      documentJson: JSON.stringify(next),
      updatedAt: next.updatedAt,
    });
    return next;
  }

  /**
   * Updates a plugin only while it still exists as the same plugin, so work
   * that finishes after a removal never brings it back.
   */
  private save(connection: McpConnection) {
    if (this.read(connection.id).createdAt !== connection.createdAt)
      throw new HttpError(
        404,
        "plugin_not_found",
        "This plugin is not connected.",
      );
    return this.insert(connection);
  }

  private lockKey(connectionId: string) {
    return `${this.workspaceId}:${connectionId}`;
  }

  private limits(maxBytes: number) {
    return {
      relayHost: new URL(this.origin).hostname,
      maxBytes,
      timeoutMs: 30_000,
    };
  }

  private oauthProvider(
    connection: McpConnection,
    session: StoredOAuthSession,
    interactive = false,
  ) {
    const metadata = mcpClientMetadata(this.env);
    const startingRefreshToken = session.tokens?.refresh_token;
    return new McpOAuthProvider(session, {
      redirectUrl: metadata.redirect_uris[0] ?? "",
      clientMetadata: metadata,
      clientMetadataUrl: metadata.client_id,
      allowAuthorizationUrl: (url) => {
        try {
          requirePublicMcpUrl(url, new URL(this.origin).hostname);
          return true;
        } catch {
          return false;
        }
      },
      interactive,
      persist: async (value) => {
        // A refresh that finishes after the plugin was removed must not
        // bring its credentials back.
        if (!mcpConnectionsFindConnection(this.storage, connection.id)) return;
        if (interactive) {
          await this.credentials.write(connection.id, connection.url, {
            kind: "oauth",
            session: value,
          });
          return;
        }
        // In the background only the tokens change, merged into whatever is
        // stored now, so a sign-in in progress keeps its state and verifier.
        const latest = await this.credentials
          .read(connection.id, connection.url)
          .catch(() => undefined);
        if (latest?.kind !== "oauth") return;
        const stored = latest.session.tokens?.refresh_token;
        // Someone else already refreshed; their tokens win over our failure.
        if (!value.tokens && stored !== startingRefreshToken) return;
        const changed =
          value.tokens?.access_token !== latest.session.tokens?.access_token;
        await this.credentials.write(connection.id, connection.url, {
          kind: "oauth",
          session: {
            ...latest.session,
            tokens: value.tokens,
            updatedAt: changed ? Date.now() : latest.session.updatedAt,
          },
        });
      },
    });
  }

  private async access(
    connection: McpConnection,
    maxBytes: number,
  ): Promise<McpServerAccess> {
    const read = () =>
      this.credentials
        .read(connection.id, connection.url)
        .catch(() => undefined);
    let credential = await read();
    if (
      credential?.kind === "oauth" &&
      credential.session.tokens?.refresh_token &&
      accessTokenExpired(credential.session)
    )
      credential = await oneAtATime(this.lockKey(connection.id), async () => {
        // Whoever held the lock may already have refreshed.
        const fresh = await read();
        if (fresh?.kind !== "oauth" || !accessTokenExpired(fresh.session))
          return fresh;
        await auth(this.oauthProvider(connection, fresh.session), {
          serverUrl: connection.url,
          fetchFn: guardedMcpFetch(this.limits(512_000)),
        }).catch(() => undefined);
        return read();
      });
    const base = { url: connection.url, limits: this.limits(maxBytes) };
    if (connection.auth.kind === "none") return base;
    if (connection.auth.kind === "headers") {
      if (credential?.kind !== "headers")
        throw new HttpError(
          409,
          "plugin_credentials_missing",
          "Add this plugin's credentials again.",
        );
      return { ...base, headers: credential.headers };
    }
    if (
      credential?.kind !== "oauth" ||
      credential.session.serverUrl !== connection.url ||
      !credential.session.tokens?.access_token
    )
      throw new HttpError(
        409,
        "plugin_not_authorized",
        "Connect this plugin before using it.",
      );
    return {
      ...base,
      authProvider: this.oauthProvider(connection, credential.session),
    };
  }

  /** Lists the server's tools and records the result on the connection. */
  async refreshTools(connection: McpConnection): Promise<McpConnection> {
    try {
      const tools = await listMcpTools(await this.access(connection, 512_000));
      return this.save({
        ...connection,
        status: "connected",
        error: undefined,
        tools,
        toolsFetchedAt: Date.now(),
      });
    } catch (error) {
      return this.save({
        ...connection,
        status:
          error instanceof UnauthorizedError ||
          (error instanceof HttpError && error.code === "plugin_not_authorized")
            ? "needs_auth"
            : "error",
        error: parseFailureMessage(error),
      });
    }
  }

  async create(principal: Principal, input: McpConnectionCreate) {
    requireWorkspaceAdministrator(this.channels, principal);
    requirePublicMcpUrl(input.url, new URL(this.origin).hostname);
    if (input.auth.kind === "headers")
      for (const { name } of input.auth.headers)
        if (reservedHeader.test(name))
          throw new HttpError(
            400,
            "plugin_header_reserved",
            `${name} cannot be set for a plugin.`,
          );
    if (mcpConnectionsFindConnection(this.storage, input.id))
      throw new HttpError(
        409,
        "plugin_exists",
        "This plugin is already added.",
      );
    if (this.list().length >= maximumConnections)
      throw new HttpError(
        409,
        "plugin_limit",
        `A workspace can connect up to ${maximumConnections} plugins.`,
      );
    // Nothing left over from an earlier plugin with this id may be reused.
    this.credentials.delete(input.id);
    const now = Date.now();
    const connection = this.insert({
      id: input.id,
      name: input.name,
      description: input.description,
      url: input.url,
      domain: input.domain,
      iconUrl: input.iconUrl,
      catalogId: input.catalogId,
      auth:
        input.auth.kind === "headers"
          ? {
              kind: "headers",
              headerNames: input.auth.headers.map(({ name }) => name),
            }
          : { kind: input.auth.kind },
      status: "needs_auth",
      tools: [],
      createdAt: now,
      updatedAt: now,
    });
    if (input.auth.kind === "headers") {
      await this.credentials.write(connection.id, connection.url, {
        kind: "headers",
        headers: input.auth.headers,
      } satisfies McpCredential);
    }
    return input.auth.kind === "oauth"
      ? connection
      : this.refreshTools(connection);
  }

  async remove(principal: Principal, id: string) {
    requireWorkspaceAdministrator(this.channels, principal);
    const connection = this.read(id);
    const credential = await this.credentials
      .read(connection.id, connection.url)
      .catch(() => undefined);
    mcpConnectionsDeleteConnection(this.storage, connection.id);
    this.credentials.delete(connection.id);
    unlinkConnection(this.storage, connection.id);
    if (credential?.kind === "oauth")
      await revokeSession(
        credential.session,
        guardedMcpFetch(this.limits(16_000)),
      );
    return { deleted: true };
  }

  async configureClient(
    principal: Principal,
    id: string,
    input: z.infer<typeof mcpConnectionClientSchema>,
  ) {
    requireWorkspaceAdministrator(this.channels, principal);
    const connection = this.read(id);
    if (connection.auth.kind !== "oauth")
      throw new HttpError(
        409,
        "plugin_not_oauth",
        "This plugin does not sign in with OAuth.",
      );
    const credential = await this.credentials
      .read(connection.id, connection.url)
      .catch(() => undefined);
    const session: StoredOAuthSession =
      credential?.kind === "oauth"
        ? credential.session
        : {
            version: 1,
            serverUrl: connection.url,
            state: "",
            updatedAt: Date.now(),
          };
    session.clientInformation = {
      client_id: input.clientId,
      ...(input.clientSecret
        ? { client_secret: input.clientSecret }
        : undefined),
    };
    delete session.tokens;
    delete session.codeVerifier;
    await this.credentials.write(connection.id, connection.url, {
      kind: "oauth",
      session,
    });
    this.save({
      ...connection,
      auth: { kind: "oauth", clientRegistration: "manual" },
    });
    return this.authorize(principal, id);
  }

  /**
   * Starts a browser sign-in. Chief discovers the authorization server,
   * registers itself and prepares PKCE here, then hands the desktop a one-time
   * start link. The provider's URL is only revealed after the person confirms
   * in that browser, which also binds the sign-in to it.
   */
  async authorize(
    principal: Principal,
    id: string,
  ): Promise<McpConnectionAuthorizeResult> {
    requireWorkspaceAdministrator(this.channels, principal);
    if (principal.kind !== "user")
      throw new HttpError(
        403,
        "plugin_user_required",
        "Only a person can connect a plugin.",
      );
    const connection = this.read(id);
    if (connection.auth.kind !== "oauth") {
      const refreshed = await this.refreshTools(connection);
      return { status: "connected", connection: refreshed };
    }
    const nonce = randomToken();
    const tag = await workspaceSignInTag(this.env, this.workspaceId);
    const outcome = await oneAtATime(this.lockKey(connection.id), async () => {
      const credential = await this.credentials
        .read(connection.id, connection.url)
        .catch(() => undefined);
      const session: StoredOAuthSession = {
        ...(credential?.kind === "oauth" ? credential.session : undefined),
        version: 1,
        serverUrl: connection.url,
        state: `${this.workspaceId}~${tag}~${nonce}`,
        updatedAt: Date.now(),
      };
      // Working tokens stay until a new sign-in succeeds, so an abandoned
      // reconnect never breaks a plugin that still works.
      delete session.codeVerifier;
      const provider = this.oauthProvider(connection, session, true);
      try {
        const result = await auth(provider, {
          serverUrl: connection.url,
          fetchFn: guardedMcpFetch(this.limits(512_000)),
        });
        requireConsistentIssuer(provider.current);
        return { result, provider };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (requiresConfiguredOAuthClient(provider.current, true))
          return { result: "client_required" as const, provider };
        throw new HttpError(
          502,
          "plugin_authorization_failed",
          parseFailureMessage(error),
        );
      }
    });
    if (outcome.result === "client_required")
      return { status: "client_required" };
    if (outcome.result === "AUTHORIZED")
      return {
        status: "connected",
        connection: await this.refreshTools(connection),
      };
    const { provider } = outcome;
    const authorizationUrl = provider.takeAuthorizationUrl();
    if (!authorizationUrl)
      throw new HttpError(
        502,
        "plugin_authorization_failed",
        "The plugin did not offer a sign-in.",
      );
    const startToken = randomToken();
    mcpConnectionsInsertOAuthRequest(this.storage, {
      nonce_hash: await sha256(nonce),
      start_hash: await sha256(startToken),
      connection_id: connection.id,
      user_id: principal.userId,
      authorization_url: authorizationUrl.toString(),
      binding_hash: null,
      expires_at: Date.now() + signInLifetimeMs,
    });
    this.save({
      ...connection,
      auth: {
        kind: "oauth",
        clientRegistration:
          provider.current.clientInformation?.client_id ===
          mcpClientMetadata(this.env).client_id
            ? "metadata_document"
            : connection.auth.clientRegistration === "manual"
              ? "manual"
              : "dynamic",
      },
    });
    const start = new URL(`${this.origin}${MCP_OAUTH_START_PATH}`);
    start.searchParams.set("w", this.workspaceId);
    start.searchParams.set("k", tag);
    start.searchParams.set("t", startToken);
    return { status: "authorize", startUrl: start.toString() };
  }

  private async pendingByStart(startToken: string) {
    const request = mcpConnectionsFindOAuthRequest(this.storage, {
      startHash: await sha256(startToken),
    });
    if (!request || request.expires_at < Date.now() || request.binding_hash)
      throw new HttpError(
        410,
        "plugin_sign_in_expired",
        "This sign-in link has expired or was already used. Start again from Chief.",
      );
    return request;
  }

  /** What the confirmation page shows before anything leaves Chief. */
  async describeStart(startToken: string) {
    const request = await this.pendingByStart(startToken);
    const connection = this.read(request.connection_id);
    const workspace = workspaceFindAuthorize<{ name: string }>(this.storage)[0];
    return {
      pluginName: connection.name,
      domain: new URL(connection.url).hostname,
      logoDomain: connection.domain ?? new URL(connection.url).hostname,
      signInHost: new URL(request.authorization_url).hostname,
      workspaceName: workspace?.name ?? "your workspace",
    };
  }

  /** Confirms in the browser: binds the sign-in to it and reveals the provider URL. */
  async confirmStart(startToken: string) {
    const request = await this.pendingByStart(startToken);
    const binding = randomToken();
    const bound = mcpConnectionsUpdateOAuthBinding(
      this.storage,
      request.nonce_hash,
      await sha256(binding),
    );
    if (bound.length !== 1)
      throw new HttpError(
        410,
        "plugin_sign_in_expired",
        "This sign-in link was already used. Start again from Chief.",
      );
    return { authorizationUrl: request.authorization_url, binding };
  }

  async completeCallback(input: {
    nonce: string;
    binding: string | null;
    code: string | null;
    error: string | null;
    issuer: string | null;
  }) {
    const nonceHash = await sha256(input.nonce);
    const request = mcpConnectionsFindOAuthRequest(this.storage, { nonceHash });
    if (!request || request.expires_at < Date.now())
      throw new HttpError(
        410,
        "plugin_sign_in_expired",
        "This sign-in expired. Start again from Chief.",
      );
    // Only the browser that confirmed can finish, or end, this sign-in.
    if (
      !request.binding_hash ||
      !input.binding ||
      !sameDigest(request.binding_hash, await sha256(input.binding))
    )
      throw new HttpError(
        403,
        "plugin_sign_in_browser",
        "Finish signing in in the same browser that started it.",
      );
    // Single use: the request is gone before the code is exchanged.
    if (mcpConnectionsDeleteOAuthRequest(this.storage, nonceHash).length !== 1)
      throw new HttpError(
        410,
        "plugin_sign_in_expired",
        "This sign-in was already finished. Start again from Chief.",
      );
    const connection = this.read(request.connection_id);
    if (input.error)
      throw new HttpError(
        400,
        "plugin_sign_in_denied",
        "The sign-in was cancelled or refused.",
      );
    const code = input.code;
    if (!code)
      throw new HttpError(
        400,
        "plugin_sign_in_invalid",
        "The provider did not return a sign-in code.",
      );
    const tag = await workspaceSignInTag(this.env, this.workspaceId);
    await oneAtATime(this.lockKey(connection.id), async () => {
      const credential = await this.credentials
        .read(connection.id, connection.url)
        .catch(() => undefined);
      if (
        credential?.kind !== "oauth" ||
        credential.session.state !== `${this.workspaceId}~${tag}~${input.nonce}`
      )
        throw new HttpError(
          409,
          "plugin_sign_in_superseded",
          "A newer sign-in replaced this one. Start again from Chief.",
        );
      // RFC 9207 mix-up defence: when an issuer is named it must be ours.
      if (
        (input.issuer !== null ||
          optionalMetadata(credential.session)
            .authorization_response_iss_parameter_supported === true) &&
        input.issuer !==
          credential.session.discovery?.authorizationServerMetadata?.issuer
      )
        throw new HttpError(
          400,
          "plugin_sign_in_issuer",
          "The sign-in came back from an unexpected provider.",
        );
      requireConsistentIssuer(credential.session);
      // What was stored before: a failed exchange must leave it, and any
      // working tokens, exactly as they were.
      const before = structuredClone(credential.session);
      delete before.codeVerifier;
      const provider = this.oauthProvider(connection, credential.session, true);
      try {
        const result = await auth(provider, {
          serverUrl: connection.url,
          authorizationCode: code,
          fetchFn: guardedMcpFetch(this.limits(512_000)),
        });
        if (result !== "AUTHORIZED") throw new UnauthorizedError();
      } catch (error) {
        await this.credentials.write(connection.id, connection.url, {
          kind: "oauth",
          session: before,
        });
        throw new HttpError(
          502,
          "plugin_sign_in_failed",
          parseFailureMessage(error),
        );
      }
      delete provider.current.codeVerifier;
      await this.credentials.write(connection.id, connection.url, {
        kind: "oauth",
        session: provider.current,
      });
    });
    return this.refreshTools(connection);
  }

  /**
   * The only way any caller reaches a plugin tool. Agents must have the
   * plugin assigned; writes need an agent that works without asking.
   * Automations run as the relay and pin whether the tool was a read.
   */
  async callTool(
    principal: Principal,
    input: McpToolCall,
  ): Promise<McpToolCallResult> {
    let connection = this.read(input.connectionId);
    if (principal.kind === "agent") {
      const config = this.channels.agentConfiguration(principal.agentId);
      if (
        !this.channels.agentIsLive(principal.agentId) ||
        !config.integrations.includes(connection.id)
      )
        throw new HttpError(
          403,
          "plugin_not_assigned",
          `${connection.name} is not assigned to this agent.`,
        );
    } else if (
      principal.kind !== "service" ||
      principal.service !== "automation"
    ) {
      throw new HttpError(
        403,
        "plugin_call_denied",
        "Only agents and automations can use plugin tools.",
      );
    }
    if (connection.status !== "connected")
      throw new HttpError(
        409,
        "plugin_not_connected",
        `${connection.name} needs to be connected again.`,
      );
    if (
      !connection.toolsFetchedAt ||
      Date.now() - connection.toolsFetchedAt > toolListFreshMs
    )
      connection = await this.refreshTools(connection);
    const tool = connection.tools.find(
      (candidate) => candidate.name === input.name,
    );
    if (!tool)
      throw new HttpError(
        404,
        "plugin_tool_missing",
        `${connection.name} no longer offers ${input.name}.`,
      );
    if (input.requireReadOnly && !tool.readOnly)
      throw new HttpError(
        409,
        "plugin_tool_changed",
        `${connection.name} now marks ${input.name} as able to change data. Review the automation before running it again.`,
      );
    if (
      !tool.readOnly &&
      principal.kind === "agent" &&
      this.channels.agentConfiguration(principal.agentId).approvals !== "auto"
    )
      throw new HttpError(
        403,
        "plugin_write_needs_approval",
        `${input.name} changes data in ${connection.name}, and this agent asks before acting. Ask a person to run it.`,
      );
    try {
      return await callMcpTool(
        await this.access(connection, 1_000_000),
        tool.name,
        input.arguments,
      );
    } catch (error) {
      if (error instanceof UnauthorizedError)
        this.save({
          ...connection,
          status: "needs_auth",
          error: parseFailureMessage(error),
        });
      throw new HttpError(
        502,
        "plugin_call_failed",
        parseFailureMessage(error),
      );
    }
  }
}
