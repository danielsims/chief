import type { AgentPluginSummary } from "@chief/plugin-api";
import type { RelayClient } from "@chief/relay-client";
import type { JsonObject } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  parseJsonString,
} from "@chief/relay-contracts";

import { PluginRuntime } from "./plugins/runtime.js";
import { deterministicUuid } from "./relay-cell-ids.js";

const plugins = new PluginRuntime(() => undefined);

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
    return await plugins.snapshot(workspaceId, input.refresh === true);
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
    const snapshot = await plugins.snapshot(workspaceId);
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
