import type { RelayClient } from "@chief/relay-client";
import type { JsonObject } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  parseJsonString,
} from "@chief/relay-contracts";

import {
  recommendationPayload,
  resolvePlugins,
  workspacePluginCatalog,
} from "./plugin-recommendation.js";
import { PluginRuntime } from "./plugins/runtime.js";
import { deterministicUuid } from "./relay-cell-ids.js";
import { searchPlugins } from "./tools/toolkits/plugins/context.js";
import { listPluginsDefinition } from "./tools/toolkits/plugins/list-plugins.js";
import { recommendPluginsDefinition } from "./tools/toolkits/plugins/recommend-plugins.js";

/** The catalog, for finding plugins nobody has installed yet. */
const plugins = new PluginRuntime(() => undefined);

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
  return {
    ...snapshot,
    plugins: workspacePluginCatalog(snapshot.plugins, connections),
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
    const {
      pluginIds = [],
      services = [],
      scope,
    } = recommendPluginsDefinition.inputSchema.parse(input);
    const snapshot = await workspacePlugins(context);
    const { plugins: selected, missing } = resolvePlugins(
      snapshot.plugins,
      pluginIds,
      services,
      scope,
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
