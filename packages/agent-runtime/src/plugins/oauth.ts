import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

import type { McpServerSpec } from "../types.js";
import type { StoredOAuthSession } from "./oauth-provider.js";
import { installedPlugin } from "./catalog.js";
import { pluginOAuthCallbackPage } from "./oauth-callback-page.js";
import {
  accessTokenExpired,
  ChiefOAuthProvider,
  deleteOAuthSession,
  oauthConnectionStatus,
  oauthSessionConnected,
  oauthStateMatches,
  PLUGIN_OAUTH_CALLBACK_URL,
  readOAuthSession,
  writeOAuthSession,
} from "./oauth-provider.js";
import { pluginsRoot, readPluginState } from "./store.js";

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

function interpolatePluginPath(
  value: string,
  pluginRoot: string,
  pluginData: string,
) {
  return value
    .replaceAll("${PLUGIN_ROOT}", pluginRoot)
    .replaceAll("${PLUGIN_DATA}", pluginData);
}

export class PluginOAuthManager {
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly failures = new Map<string, string>();

  constructor(private readonly onConnected?: (workspaceId: string) => void) {}

  async start(workspaceId: string, pluginId: string) {
    this.failures.delete(`${workspaceId}\0${pluginId}`);
    for (const [pendingState, pending] of this.pending) {
      if (
        pending.workspaceId === workspaceId &&
        pending.pluginId === pluginId
      ) {
        this.pending.delete(pendingState);
      }
    }
    const { loaded } = await installedPlugin(workspaceId, pluginId);
    const remotes = loaded.mcpServers.filter(
      ({ spec }) => spec.type === "streamable-http" || spec.type === "sse",
    );
    if (remotes.length === 0) {
      throw new Error(
        `${loaded.manifest.name} has no remote MCP server to authorize.`,
      );
    }
    for (const remote of remotes) {
      if (
        remote.spec.type !== "streamable-http" &&
        remote.spec.type !== "sse"
      ) {
        continue;
      }
      const existing = await readOAuthSession(
        workspaceId,
        pluginId,
        remote.name,
      );
      if (oauthSessionConnected(existing)) {
        continue;
      }
      const state = randomBytes(32).toString("base64url");
      const session: StoredOAuthSession = {
        ...existing,
        version: 1,
        serverUrl: remote.spec.url,
        state,
        authorizedWithoutTokens: false,
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
        session.authorizedWithoutTokens = !session.tokens?.access_token;
        session.updatedAt = Date.now();
        await writeOAuthSession(workspaceId, pluginId, remote.name, session);
        continue;
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
    return {
      status: "connected" as const,
      serverName: remotes.at(-1)?.name ?? pluginId,
    };
  }

  async connectionState(workspaceId: string, pluginId: string) {
    if (
      [...this.pending.values()].some(
        (pending) =>
          pending.workspaceId === workspaceId && pending.pluginId === pluginId,
      )
    ) {
      return { status: "waiting" as const };
    }
    const failure = this.failures.get(`${workspaceId}\0${pluginId}`);
    if (failure) return { status: "failed" as const, error: failure };
    try {
      const { loaded } = await installedPlugin(workspaceId, pluginId);
      const remotes = loaded.mcpServers.filter(
        ({ spec }) => spec.type === "streamable-http" || spec.type === "sse",
      );
      if (remotes.length > 0) {
        const status = oauthConnectionStatus(
          await Promise.all(
            remotes.map((server) =>
              readOAuthSession(workspaceId, pluginId, server.name),
            ),
          ),
        );
        return { status } as const;
      }
    } catch {
      /* Missing or invalid plugins are not connected. */
    }
    return { status: "authorization_required" as const };
  }

  async disconnect(workspaceId: string, pluginId: string) {
    this.failures.delete(`${workspaceId}\0${pluginId}`);
    try {
      const { loaded } = await installedPlugin(workspaceId, pluginId);
      await Promise.all(
        loaded.mcpServers.map(({ name }) =>
          deleteOAuthSession(workspaceId, pluginId, name),
        ),
      );
    } catch {
      /* A missing plugin has no connection to retain. */
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
              cwd: resolve(pluginRoot, interpolate(spec.cwd ?? ".")),
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
          const session = await readOAuthSession(
            workspaceId,
            installation.id,
            name,
          );
          if (session && accessTokenExpired(session)) continue;
          if (
            !session?.tokens?.access_token &&
            !session?.authorizedWithoutTokens
          )
            continue;
          servers.push({
            name: `plugin-${installation.id}-${name}`,
            command: "",
            args: [],
            url: spec.url,
            headers: {
              ...spec.headers,
              ...(session.tokens?.access_token
                ? { Authorization: `Bearer ${session.tokens.access_token}` }
                : undefined),
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
    const url = new URL(req.url ?? "/", PLUGIN_OAUTH_CALLBACK_URL);
    if (req.method !== "GET" || url.pathname !== "/plugins/oauth/callback")
      return false;
    const state = url.searchParams.get("state") ?? "";
    const pending = this.pending.get(state);
    const code = url.searchParams.get("code");
    const providerError = url.searchParams.get("error");
    if (!pending || !oauthStateMatches(state, pending.state)) {
      res.writeHead(400, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        pluginOAuthCallbackPage(
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
      const session = await readOAuthSession(
        pending.workspaceId,
        pending.pluginId,
        pending.serverName,
      );
      if (!session || !oauthStateMatches(session.state, state)) {
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
      this.failures.delete(`${pending.workspaceId}\0${pending.pluginId}`);
      const next = await this.start(pending.workspaceId, pending.pluginId);
      if (next.status === "authorization_required") {
        res.writeHead(302, {
          location: next.authorizationUrl,
          "cache-control": "no-store",
        });
        res.end();
        return true;
      }
      this.onConnected?.(pending.workspaceId);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        pluginOAuthCallbackPage(
          `${pending.pluginName} is connected`,
          "You can close this window and return to Chief.",
          true,
        ),
      );
    } catch (error) {
      this.pending.delete(state);
      this.failures.set(
        `${pending.workspaceId}\0${pending.pluginId}`,
        error instanceof Error ? error.message : String(error),
      );
      this.onConnected?.(pending.workspaceId);
      res.writeHead(400, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(
        pluginOAuthCallbackPage(
          "Authorization failed",
          error instanceof Error ? error.message : String(error),
          false,
        ),
      );
    }
    return true;
  }
}
