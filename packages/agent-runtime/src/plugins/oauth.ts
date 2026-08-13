import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

import type { McpServerSpec } from "../types.js";
import { workspaceSecrets } from "../workspace-secrets.js";
import { installedPlugin } from "./catalog.js";
import { pluginsRoot, readPluginState } from "./store.js";

const CALLBACK_URL = "http://127.0.0.1:4318/plugins/oauth/callback";

interface StoredOAuthSession {
  version: 1;
  serverUrl: string;
  state: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discovery?: OAuthDiscoveryState;
  updatedAt: number;
}

interface PendingAuthorization {
  workspaceId: string;
  pluginId: string;
  pluginName: string;
  serverName: string;
  serverUrl: string;
  state: string;
}

function displayName(value: string) {
  return value
    .split(/[.-]/g)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function secretName(pluginId: string, serverName: string) {
  const safe = `${pluginId}-${serverName}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return `plugin-oauth-${safe}.json`;
}

async function readSession(
  workspaceId: string,
  pluginId: string,
  serverName: string,
): Promise<StoredOAuthSession | undefined> {
  try {
    const value = await workspaceSecrets.readPrivate(
      workspaceId,
      secretName(pluginId, serverName),
    );
    if (!value) return undefined;
    const parsed = JSON.parse(value) as StoredOAuthSession;
    return parsed;
  } catch {
    return undefined;
  }
}

async function writeSession(
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

class ChiefOAuthProvider implements OAuthClientProvider {
  private authorizationUrl?: URL;

  constructor(
    private readonly workspaceId: string,
    private readonly pluginId: string,
    private readonly serverName: string,
    private session: StoredOAuthSession,
  ) {}

  get redirectUrl() {
    return CALLBACK_URL;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Chief",
      client_uri: "https://github.com/latent-supply/chief",
      redirect_uris: [CALLBACK_URL],
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
    await writeSession(
      this.workspaceId,
      this.pluginId,
      this.serverName,
      this.session,
    );
  }
}

function stateMatches(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function interpolatePluginPath(
  value: string,
  pluginRoot: string,
  pluginData: string,
) {
  return value
    .replaceAll("${PLUGIN_ROOT}", pluginRoot)
    .replaceAll("${PLUGIN_DATA}", pluginData);
}

function callbackPage(title: string, detail: string, ok: boolean) {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character] ?? character,
    );
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{background:#0b0b0b;color:#f5f5f5;font:16px system-ui;display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:34rem;padding:2rem;border:1px solid #333;border-radius:1rem;background:#191919}p{color:#aaa;line-height:1.5}</style></head><body><main class="card"><h1>${escape(title)}</h1><p>${escape(detail)}</p>${ok ? "<script>setTimeout(()=>window.close(),1800)</script>" : ""}</main></body></html>`;
}

export class PluginOAuthManager {
  private readonly pending = new Map<string, PendingAuthorization>();

  constructor(private readonly onConnected?: (workspaceId: string) => void) {}

  async start(workspaceId: string, pluginId: string) {
    const { loaded } = await installedPlugin(workspaceId, pluginId);
    const remote = loaded.mcpServers.find(
      ({ spec }) => spec.type === "streamable-http" || spec.type === "sse",
    );
    if (
      !remote ||
      (remote.spec.type !== "streamable-http" && remote.spec.type !== "sse")
    ) {
      throw new Error(
        `${loaded.manifest.name} has no remote MCP server to authorize.`,
      );
    }
    const state = randomBytes(32).toString("base64url");
    const existing = await readSession(workspaceId, pluginId, remote.name);
    const session: StoredOAuthSession = {
      ...existing,
      version: 1,
      serverUrl: remote.spec.url,
      state,
      updatedAt: Date.now(),
    };
    const provider = new ChiefOAuthProvider(
      workspaceId,
      pluginId,
      remote.name,
      session,
    );
    const result = await auth(provider, { serverUrl: remote.spec.url });
    if (result === "AUTHORIZED") {
      return { status: "connected" as const, serverName: remote.name };
    }
    const authorizationUrl = provider.takeAuthorizationUrl();
    if (!authorizationUrl)
      throw new Error("MCP OAuth did not return an authorization URL.");
    this.pending.set(state, {
      workspaceId,
      pluginId,
      pluginName: displayName(pluginId),
      serverName: remote.name,
      serverUrl: remote.spec.url,
      state,
    });
    return {
      status: "authorization_required" as const,
      serverName: remote.name,
      authorizationUrl: authorizationUrl.toString(),
    };
  }

  async connected(workspaceId: string, pluginId: string) {
    try {
      const { loaded } = await installedPlugin(workspaceId, pluginId);
      for (const server of loaded.mcpServers) {
        const session = await readSession(workspaceId, pluginId, server.name);
        if (session?.tokens?.access_token) return true;
      }
    } catch {
      // Invalid or removed plugins are not connected.
    }
    return false;
  }

  async disconnect(workspaceId: string, pluginId: string) {
    try {
      const { loaded } = await installedPlugin(workspaceId, pluginId);
      await Promise.all(
        loaded.mcpServers.map(({ name }) =>
          workspaceSecrets.deletePrivate(
            workspaceId,
            secretName(pluginId, name),
          ),
        ),
      );
    } catch {
      // A missing or invalid package has no usable connection to retain.
    }
    for (const [state, pending] of this.pending) {
      if (
        pending.workspaceId === workspaceId &&
        pending.pluginId === pluginId
      ) {
        this.pending.delete(state);
      }
    }
  }

  async mcpServers(workspaceId: string): Promise<McpServerSpec[]> {
    const state = await readPluginState(workspaceId);
    const servers: McpServerSpec[] = [];
    for (const installation of Object.values(state.installations)) {
      if (!installation.enabled || !installation.trusted) continue;
      try {
        const { loaded } = await installedPlugin(workspaceId, installation.id);
        const pluginData = join(
          pluginsRoot(workspaceId),
          "data",
          installation.id,
        );
        await mkdir(pluginData, { recursive: true, mode: 0o700 });
        for (const { name, spec } of loaded.mcpServers) {
          if (spec.type === "stdio") {
            const pluginRoot = loaded.root;
            const interpolate = (value: string) =>
              interpolatePluginPath(value, pluginRoot, pluginData);
            servers.push({
              name: `plugin-${installation.id}-${name}`,
              command: spec.command.startsWith("./")
                ? resolve(pluginRoot, spec.command)
                : spec.command,
              args: (spec.args ?? []).map(interpolate),
              cwd: resolve(pluginRoot, spec.cwd ?? "."),
              env: {
                ...Object.fromEntries(
                  Object.entries(spec.env ?? {}).map(([key, value]) => [
                    key,
                    interpolate(value),
                  ]),
                ),
                PLUGIN_ROOT: pluginRoot,
                PLUGIN_DATA: pluginData,
              },
            });
            continue;
          }
          const session = await readSession(workspaceId, installation.id, name);
          if (!session?.tokens?.access_token) continue;
          servers.push({
            name: `plugin-${installation.id}-${name}`,
            command: "",
            args: [],
            url: spec.url,
            headers: {
              ...spec.headers,
              Authorization: `Bearer ${session.tokens.access_token}`,
            },
          });
        }
      } catch (error) {
        console.error(`[plugins] Could not attach ${installation.id}:`, error);
      }
    }
    return servers;
  }

  async handleCallback(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", CALLBACK_URL);
    if (req.method !== "GET" || url.pathname !== "/plugins/oauth/callback")
      return false;
    const state = url.searchParams.get("state") ?? "";
    const pending = this.pending.get(state);
    const code = url.searchParams.get("code");
    const providerError = url.searchParams.get("error");
    if (!pending || !stateMatches(state, pending.state)) {
      res.writeHead(400, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        callbackPage(
          "Authorization expired",
          "Return to Chief and choose Reopen to start a fresh sign-in.",
          false,
        ),
      );
      return true;
    }
    try {
      if (providerError)
        throw new Error(
          url.searchParams.get("error_description") ?? providerError,
        );
      if (!code)
        throw new Error("The provider did not return an authorization code.");
      const session = await readSession(
        pending.workspaceId,
        pending.pluginId,
        pending.serverName,
      );
      if (!session || !stateMatches(session.state, state)) {
        throw new Error("The saved authorization request no longer matches.");
      }
      const provider = new ChiefOAuthProvider(
        pending.workspaceId,
        pending.pluginId,
        pending.serverName,
        session,
      );
      const result = await auth(provider, {
        serverUrl: pending.serverUrl,
        authorizationCode: code,
      });
      if (result !== "AUTHORIZED")
        throw new Error("The provider did not complete authorization.");
      this.pending.delete(state);
      this.onConnected?.(pending.workspaceId);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        callbackPage(
          `${pending.pluginName} is connected`,
          "You can close this window and return to Chief.",
          true,
        ),
      );
    } catch (error) {
      res.writeHead(400, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        callbackPage(
          "Authorization failed",
          error instanceof Error ? error.message : String(error),
          false,
        ),
      );
    }
    return true;
  }
}
