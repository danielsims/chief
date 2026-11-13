import type { AgentPluginSummary } from "@chief/plugin-api";
import type { RelayClient } from "@chief/relay-client";
import type { JsonObject, McpConnection } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  parseJsonString,
} from "@chief/relay-contracts";

import { PluginRuntime } from "./plugins/runtime.js";
import { deterministicUuid } from "./relay-cell-ids.js";
import { searchPlugins } from "./tools/toolkits/plugins/context.js";
import { listPluginsDefinition } from "./tools/toolkits/plugins/list-plugins.js";

/** The catalog, for finding plugins nobody has installed yet. */
const plugins = new PluginRuntime(() => undefined);

type WorkspacePlugin = AgentPluginSummary & {
  /** Set once the workspace has connected it in the relay. */
  connectionId?: string;
  toolCount?: number;
  /** Whether this agent may use it; connected alone isn't enough. */
  agentAccess?: boolean;
};

function connectionStatus(connection: McpConnection) {
  return connection.status === "connected"
    ? ("connected" as const)
    : connection.status === "needs_auth"
      ? ("authorization_required" as const)
      : ("error" as const);
}

function catalogDomain(plugin: AgentPluginSummary) {
  return plugin.source.type === "discovery" || plugin.source.type === "setup"
    ? plugin.source.domain
    : plugin.domains?.[0];
}

/**
 * The workspace's plugins as the relay holds them, over the catalog. The
 * relay's connections are the only record of what is installed, connected and
 * assigned; the catalog only adds plugins nobody has installed yet.
 */
async function workspacePlugins(
  context: { client: RelayClient; workspaceId: string; agentId: string },
  refresh = false,
) {
  const [snapshot, connections] = await Promise.all([
    plugins.snapshot(context.workspaceId, refresh),
    context.client.plugins.list(),
  ]);
  const workspaceEntry = (connection: McpConnection) => ({
    status: connectionStatus(connection),
    connectionId: connection.id,
    toolCount: connection.tools.length,
    agentAccess: connection.assignedToYou === true,
  });
  const matched = new Set<string>();
  const catalog: WorkspacePlugin[] = snapshot.plugins.map((plugin) => {
    const domain = catalogDomain(plugin)?.toLowerCase();
    const connection = connections.find(
      (item) =>
        item.catalogId === plugin.id ||
        (domain !== undefined && item.domain?.toLowerCase() === domain),
    );
    if (!connection) return { ...plugin, status: "available" };
    matched.add(connection.id);
    return { ...plugin, ...workspaceEntry(connection) };
  });
  const custom: WorkspacePlugin[] = connections
    .filter((connection) => !matched.has(connection.id))
    .map((connection) => ({
      id: connection.catalogId ?? connection.id,
      name: connection.name,
      description: connection.description,
      category: "Other",
      source: {
        type: "setup",
        domain: connection.domain ?? new URL(connection.url).hostname,
      },
      enabled: true,
      trusted: true,
      ...workspaceEntry(connection),
    }));
  const installed = [...custom, ...catalog].filter(
    (plugin) => plugin.connectionId,
  );
  return {
    ...snapshot,
    plugins: [
      ...installed,
      ...catalog.filter((plugin) => !plugin.connectionId),
    ],
  };
}

function requiredString(input: JsonObject, key: string) {
  const value = input[key];
  const parsed = parseJsonString(value)?.trim();
  if (!parsed) {
    throw new Error(`${key} is required.`);
  }
  return parsed;
}

function optionalString(input: JsonObject, key: string) {
  const value = input[key];
  const parsed = parseJsonString(value)?.trim();
  return parsed === "" ? undefined : parsed;
}

function recommendationPayload(
  plugin: AgentPluginSummary,
  placement: {
    workspaceId: string;
    conversationId: string;
    threadRootId?: string;
    agentId: string;
    rationale?: string;
  },
) {
  const domain =
    plugin.source.type === "discovery" || plugin.source.type === "setup"
      ? plugin.source.domain
      : plugin.domains?.[0];
  return {
    ...placement,
    pluginId: plugin.id,
    name: plugin.name,
    description: plugin.description,
    category: plugin.category,
    sourceType: plugin.source.type,
    status: plugin.status,
    enabled: plugin.enabled,
    trusted: plugin.trusted,
    homepage: plugin.homepage,
    iconUrl: plugin.iconUrl,
    domain,
  };
}

export async function callPluginTool(
  name: string,
  input: JsonObject,
  context: {
    client: RelayClient;
    workspaceId: string;
    agentId: string;
    conversationId: string;
    threadRootId?: string;
  },
) {
  const { client, workspaceId, agentId } = context;
  if (name === "plugins_list") {
    const query = listPluginsDefinition.querySchema.parse({
      query: parseJsonString(input.query) ?? "",
      limit: input.limit ?? undefined,
      refresh: input.refresh === true ? "true" : undefined,
    });
    return searchPlugins(
      await workspacePlugins(context, query.refresh),
      query.query,
      query.limit,
    );
  }
  if (name === "plugins_recommend") {
    const conversationId = requiredString(input, "channelId");
    const threadRootId = optionalString(input, "threadRootId");
    const rationale = requiredString(input, "content");
    const idempotencyKey = requiredString(input, "idempotencyKey");
    const requested = Array.isArray(input.pluginIds)
      ? [
          ...new Set(
            input.pluginIds.flatMap((value) => {
              const pluginId = parseJsonString(value)?.trim();
              return pluginId ? [pluginId] : [];
            }),
          ),
        ].slice(0, 8)
      : [];
    if (requested.length === 0) throw new Error("pluginIds is required.");
    const snapshot = await workspacePlugins(context);
    const selected = requested.flatMap((pluginId) => {
      const plugin = snapshot.plugins.find((item) => item.id === pluginId);
      return plugin ? [plugin] : [];
    });
    const missing = requested.filter(
      (pluginId) => !selected.some((plugin) => plugin.id === pluginId),
    );
    if (missing.length > 0) {
      throw new Error(`Unknown plugin IDs: ${missing.join(", ")}.`);
    }
    const commandId = deterministicUuid(
      `${workspaceId}:${agentId}:${conversationId}:${threadRootId ?? ""}:plugin-recommendation:${idempotencyKey}`,
    );
    const message = {
      messageId: commandId,
      conversationId,
      threadRootId,
      body: rationale,
      mentions: [],
      components: selected.map((plugin) => {
        const placement = {
          workspaceId,
          conversationId,
          threadRootId,
          agentId,
          rationale,
        };
        return {
          id: deterministicUuid(`${commandId}:${plugin.id}`),
          kind: "plugin.recommendation",
          version: 1,
          payload: recommendationPayload(plugin, placement),
        };
      }),
    };
    const command = appendMessageCommandSchema.parse({
      commandId,
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: message,
    });
    return await client.appendMessage(conversationId, command);
  }
  if (name === "plugins_install" || name === "plugins_authorize") {
    // Installed in the workspace already: report it rather than starting a
    // separate on-device install the workspace can't see.
    const pluginId = requiredString(input, "pluginId");
    const existing = (await workspacePlugins(context)).plugins.find(
      (plugin) => plugin.id === pluginId && plugin.connectionId,
    );
    if (existing?.status === "connected")
      return {
        pluginId,
        status: "connected",
        agentAccess: existing.agentAccess,
      };
  }
  if (name === "plugins_install") {
    return await plugins.install(
      workspaceId,
      requiredString(input, "pluginId"),
      input.trusted === true,
    );
  }
  if (name === "plugins_authorize") {
    const authorization = await plugins.authorize(
      workspaceId,
      requiredString(input, "pluginId"),
    );
    if (authorization.status === "connected") return authorization;
    const { conversationId, threadRootId } = context;
    const idempotencyKey = `${requiredString(input, "pluginId")}:authorize`;
    const commandId = deterministicUuid(
      `${workspaceId}:${agentId}:${conversationId}:${threadRootId ?? ""}:plugin-authorization:${idempotencyKey}`,
    );
    const authorizationPayload = {
      workspaceId,
      conversationId,
      threadRootId,
      agentId,
      ...authorization,
    };
    const message = {
      messageId: commandId,
      conversationId,
      threadRootId,
      body:
        authorization.kind === "plugin_oauth_client"
          ? `Configure an OAuth client for ${authorization.pluginName} to continue.`
          : authorization.kind === "plugin_api_key"
            ? `Add your ${authorization.pluginName} ${authorization.label} to continue.`
            : `Authorize ${authorization.pluginName} to continue.`,
      mentions: [],
      components: [
        {
          id: deterministicUuid(`${commandId}:${authorization.pluginId}`),
          kind: "plugin.authorization",
          version: 1,
          payload: authorizationPayload,
        },
      ],
    };
    const command = appendMessageCommandSchema.parse({
      commandId,
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: message,
    });
    const posted = await client.appendMessage(conversationId, command);
    return { authorization, message: posted.message };
  }
  if (name === "plugins_uninstall") {
    const pluginId = requiredString(input, "pluginId");
    await plugins.uninstall(workspaceId, pluginId);
    return { pluginId, status: "uninstalled" };
  }
  throw new Error("Unknown plugin tool.");
}
