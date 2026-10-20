import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { z } from "zod";

import type {
  AgentPluginSummary,
  ClientMessage,
  PluginAuthorizationAction,
  ServerMessage,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type {
  JsonObject,
  McpConnection,
  McpConnectionAuthorizeResult,
} from "@chief/relay-contracts";
import { parseMcpSurfaceFromDocument } from "@chief/agent-runtime/mcp-surface";

import { requestDesktopPluginHost } from "./desktop-plugin-host";
import { loadRelayPluginCatalog } from "./relay-plugin-catalog";

/**
 * Plugins in a relay workspace. Remote MCP servers are workspace connections
 * held by the relay, so hosted and device agents share them. Skill packages
 * still install on this device through the local plugin host.
 */
const pluginSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bundled"), path: z.string() }),
  z.object({
    type: z.literal("git"),
    url: z.string(),
    sha: z.string(),
    path: z.string().optional(),
  }),
  z.object({
    type: z.literal("discovery"),
    registry: z.string(),
    domain: z.string(),
  }),
  z.object({ type: z.literal("setup"), domain: z.string() }),
]);

const pluginSnapshotSchema = z.object({
  plugins: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      category: z.string(),
      homepage: z.string().optional(),
      repository: z.string().optional(),
      iconUrl: z.string().optional(),
      featured: z.boolean().optional(),
      popularity: z.number().optional(),
      domains: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
      source: pluginSourceSchema,
      status: z.enum([
        "available",
        "installed",
        "authorization_required",
        "waiting",
        "connected",
        "failed",
        "reconnect",
        "error",
      ]),
      installedAt: z.number().optional(),
      enabled: z.boolean(),
      trusted: z.boolean(),
      diagnostics: z.array(z.string()).optional(),
    }),
  ),
});

const pluginOAuthUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname))
  );
});

const hostAuthorizationSchema = z.union([
  z.object({
    pluginId: z.string(),
    pluginName: z.string(),
    description: z.string(),
    provider: z.string(),
    kind: z.literal("plugin_authorization"),
    authorizationUrl: pluginOAuthUrlSchema,
    status: z.literal("authorization_required"),
  }),
  z.object({
    pluginId: z.string(),
    pluginName: z.string(),
    description: z.string(),
    provider: z.string(),
    kind: z.literal("plugin_oauth_client"),
    serverName: z.string(),
    callbackUrl: pluginOAuthUrlSchema,
    setupUrl: pluginOAuthUrlSchema.optional(),
    status: z.literal("client_configuration_required"),
  }),
  z.object({ pluginId: z.string(), status: z.literal("connected") }),
]);

type PluginCommand = Extract<
  ClientMessage,
  {
    type:
      "listPlugins" | "installPlugin" | "authorizePlugin" | "uninstallPlugin";
  }
>;

export interface RelayPluginContext {
  relay: Pick<RelayClient, "plugins">;
  workspaceId: string;
  emit(message: ServerMessage): void;
}

// A browser sign-in in flight; the relay only knows the connection still needs auth.
const signingIn = new Map<string, number>();
const signInWindowMs = 10 * 60_000;
// Which plugins the relay manages, from the last list, so commands route correctly.
const relayManaged = new Map<string, Set<string>>();

function isSigningIn(id: string) {
  const until = signingIn.get(id);
  if (until && until > Date.now()) return true;
  signingIn.delete(id);
  return false;
}

function connectionKey(connection: McpConnection) {
  return connection.catalogId ?? connection.id;
}

function connectionStatus(
  connection: McpConnection,
): AgentPluginSummary["status"] {
  if (connection.status === "connected") {
    signingIn.delete(connectionKey(connection));
    return "connected";
  }
  if (connection.status === "error") return "failed";
  return isSigningIn(connectionKey(connection))
    ? "waiting"
    : "authorization_required";
}

function withConnection(
  plugin: AgentPluginSummary,
  connection: McpConnection,
): AgentPluginSummary {
  return {
    ...plugin,
    status: connectionStatus(connection),
    enabled: true,
    trusted: true,
    installedAt: connection.createdAt,
    ...(connection.error ? { diagnostics: [connection.error] } : undefined),
    connection: {
      id: connection.id,
      url: connection.url,
      auth: connection.auth.kind,
      tools: connection.tools.map(({ name, title, description, readOnly }) => ({
        name,
        ...(title ? { title } : undefined),
        description,
        readOnly,
      })),
    },
  };
}

/** A server added by address, shown like any other connector. */
function customPlugin(connection: McpConnection): AgentPluginSummary {
  const domain = connection.domain ?? new URL(connection.url).hostname;
  return withConnection(
    {
      id: connection.id,
      name: connection.name,
      description: connection.description || `MCP server at ${domain}.`,
      category: "Other",
      source: { type: "discovery", registry: "custom", domain },
      domains: [domain],
      status: "available",
      enabled: false,
      trusted: false,
    },
    connection,
  );
}

async function hostPlugins(workspaceId: string, refresh: boolean) {
  try {
    const response = await requestDesktopPluginHost("/plugins/list", {
      workspaceId,
      refresh,
    });
    return pluginSnapshotSchema
      .parse(response.snapshot)
      .plugins.filter((plugin) => plugin.source.type !== "discovery");
  } catch {
    // Skill packages are optional; connectors still work without the host.
    return [];
  }
}

async function listPlugins(context: RelayPluginContext, refresh: boolean) {
  const [catalog, connections, skills] = await Promise.all([
    loadRelayPluginCatalog(refresh),
    context.relay.plugins.list(),
    hostPlugins(context.workspaceId, refresh),
  ]);
  const byKey = new Map(connections.map((item) => [connectionKey(item), item]));
  const plugins = [
    ...connections
      .filter(
        (item) =>
          !catalog.plugins.some((plugin) => plugin.id === connectionKey(item)),
      )
      .map(customPlugin),
    ...catalog.plugins.map((plugin) => {
      const connection = byKey.get(plugin.id);
      return connection ? withConnection(plugin, connection) : plugin;
    }),
    ...skills,
  ];
  relayManaged.set(
    context.workspaceId,
    new Set(
      plugins
        .filter((plugin) => plugin.source.type === "discovery")
        .map((plugin) => plugin.id),
    ),
  );
  context.emit({
    type: "plugins",
    workspaceId: context.workspaceId,
    plugins,
    sources: catalog.sources,
    refreshedAt: catalog.refreshedAt,
    stale: catalog.stale,
    ...(catalog.warning ? { warning: catalog.warning } : undefined),
  });
  return { plugins, connections };
}

function connectionIdFor(slug: string) {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/u, "");
}

async function addCatalogPlugin(
  context: RelayPluginContext,
  plugin: AgentPluginSummary,
) {
  if (plugin.source.type !== "discovery")
    throw new Error(`${plugin.name} can't be added here.`);
  const fetcher = isTauri() ? tauriFetch : globalThis.fetch;
  const response = await fetcher(
    `https://integrations.sh/api/${encodeURIComponent(plugin.source.domain)}/surface`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok)
    throw new Error(`Could not find ${plugin.name}'s MCP server.`);
  const surface = parseMcpSurfaceFromDocument(await response.json());
  if (!surface || new URL(surface.url).protocol !== "https:")
    throw new Error(`${plugin.name} doesn't publish a secure MCP server yet.`);
  if (surface.auth === "headers")
    throw new Error(
      `${plugin.name} needs an API key. Add it with Add MCP server.`,
    );
  await context.relay.plugins.create({
    id: connectionIdFor(plugin.id),
    name: plugin.name,
    description: plugin.description.slice(0, 1_000),
    url: surface.url,
    domain: plugin.source.domain,
    ...(plugin.iconUrl ? { iconUrl: plugin.iconUrl } : undefined),
    catalogId: plugin.id,
    auth: { kind: surface.auth },
  });
}

function authorizationAction(
  context: RelayPluginContext,
  plugin: AgentPluginSummary,
  result: McpConnectionAuthorizeResult,
): PluginAuthorizationAction | undefined {
  const base = {
    pluginId: plugin.id,
    pluginName: plugin.name,
    description: plugin.description,
    provider: plugin.name,
  };
  if (result.status === "authorize") {
    signingIn.set(plugin.id, Date.now() + signInWindowMs);
    return {
      ...base,
      kind: "plugin_authorization",
      authorizationUrl: result.startUrl,
      status: "authorization_required",
    };
  }
  if (result.status === "client_required")
    return {
      ...base,
      kind: "plugin_oauth_client",
      serverName: plugin.name,
      callbackUrl: context.relay.plugins.oauthCallbackUrl(),
      status: "client_configuration_required",
    };
  return undefined;
}

async function routeHostCommand(
  message: Exclude<PluginCommand, { type: "listPlugins" }>,
  context: RelayPluginContext,
) {
  if (message.type === "installPlugin" || message.type === "uninstallPlugin") {
    await requestDesktopPluginHost(
      message.type === "installPlugin"
        ? "/plugins/install"
        : "/plugins/uninstall",
      {
        workspaceId: context.workspaceId,
        pluginId: message.pluginId,
        ...(message.type === "installPlugin"
          ? { trusted: message.trusted }
          : undefined),
      },
    );
    return;
  }
  const response: JsonObject = await requestDesktopPluginHost(
    "/plugins/authorize",
    {
      workspaceId: context.workspaceId,
      pluginId: message.pluginId,
      oauthClient: message.oauthClient,
    },
  );
  const action = hostAuthorizationSchema.safeParse(response.action);
  if (!action.success)
    throw new Error(
      "The plugin host returned an invalid authorization action.",
    );
  if (action.data.status !== "connected")
    context.emit({
      type: "pluginAuthorization",
      workspaceId: context.workspaceId,
      requestId: message.requestId,
      action: action.data,
    });
}

export async function routeRelayPluginCommand(
  message: PluginCommand,
  context: RelayPluginContext,
) {
  if (message.type === "listPlugins") {
    await listPlugins(context, message.refresh === true);
    return;
  }
  // A server added a moment ago is not in the last list yet.
  if (!relayManaged.get(context.workspaceId)?.has(message.pluginId))
    await listPlugins(context, false);
  if (!relayManaged.get(context.workspaceId)?.has(message.pluginId)) {
    try {
      await routeHostCommand(message, context);
    } finally {
      await listPlugins(context, false);
    }
    return;
  }
  const { plugins, connections } = await listPlugins(context, false);
  const plugin = plugins.find((item) => item.id === message.pluginId);
  if (!plugin) throw new Error("This plugin is no longer available.");
  const connection = connections.find(
    (item) => connectionKey(item) === plugin.id,
  );
  try {
    if (message.type === "installPlugin") {
      if (!connection) await addCatalogPlugin(context, plugin);
      return;
    }
    if (!connection)
      throw new Error(`Add ${plugin.name} before connecting it.`);
    if (message.type === "uninstallPlugin") {
      signingIn.delete(plugin.id);
      await context.relay.plugins.remove(connection.id);
      return;
    }
    const result = message.oauthClient
      ? await context.relay.plugins.configureClient(connection.id, {
          clientId: message.oauthClient.clientId,
          ...(message.oauthClient.clientSecret
            ? { clientSecret: message.oauthClient.clientSecret }
            : undefined),
        })
      : await context.relay.plugins.authorize(connection.id);
    const action = authorizationAction(context, plugin, result);
    if (action)
      context.emit({
        type: "pluginAuthorization",
        workspaceId: context.workspaceId,
        requestId: message.requestId,
        action,
      });
  } finally {
    await listPlugins(context, false);
  }
}
