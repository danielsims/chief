import type {
  AgentJob,
  AgentPrincipal,
  JsonObject,
  JsonValue,
} from "@chief/relay-contracts";
import {
  channelCreateCommandSchema,
  channelMemberAddCommandSchema,
  isJsonString,
  messagePageSchema,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

import { publishAgentMessage } from "./agent-message-publisher";
import { HttpError } from "./http";
import { withTrustedContext } from "./internal-context";

export const hostedAgentToolDefinitions = [
  tool("relay_channels_list", "List channels visible to this agent.", {
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  tool("relay_workspace_members", "List workspace members and their roles.", {
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  tool(
    "relay_messages_list",
    "Read recent top-level messages in a conversation.",
    {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["conversationId"],
      additionalProperties: false,
    },
  ),
  tool(
    "relay_message_post",
    "Post a message to a channel, direct message, or thread.",
    {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        threadRootId: { type: "string" },
        body: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["conversationId", "body", "idempotencyKey"],
      additionalProperties: false,
    },
  ),
  tool("relay_channels_create", "Create a workspace channel.", {
    type: "object",
    properties: {
      conversationId: { type: "string" },
      name: { type: "string" },
      isPrivate: { type: "boolean" },
    },
    required: ["conversationId", "name", "isPrivate"],
    additionalProperties: false,
  }),
  tool(
    "relay_channels_members_add",
    "Add one or more workspace members to a channel.",
    {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        kind: { type: "string", enum: ["user", "agent"] },
        principalIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 32,
        },
      },
      required: ["conversationId", "kind", "principalIds"],
      additionalProperties: false,
    },
  ),
  tool(
    "plugins_list",
    "Search the portable plugin catalog available to this hosted cell.",
    {
      type: "object",
      properties: { refresh: { type: "boolean" } },
      additionalProperties: false,
    },
  ),
  tool(
    "plugins_recommend",
    "Present real clickable plugin cards in a relay conversation.",
    {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        threadRootId: { type: "string" },
        pluginIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 8,
        },
        rationale: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["conversationId", "pluginIds", "idempotencyKey"],
      additionalProperties: false,
    },
  ),
  tool(
    "plugins_install",
    "Prepare an approved plugin for a compatible signed cell.",
    {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        trusted: { type: "boolean" },
      },
      required: ["pluginId", "trusted"],
      additionalProperties: false,
    },
  ),
  tool(
    "plugins_authorize",
    "Check the authorization handoff for an installed plugin.",
    {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        conversationId: { type: "string" },
        threadRootId: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["pluginId", "conversationId", "idempotencyKey"],
      additionalProperties: false,
    },
  ),
  tool("plugins_uninstall", "Remove a plugin from a compatible signed cell.", {
    type: "object",
    properties: { pluginId: { type: "string" } },
    required: ["pluginId"],
    additionalProperties: false,
  }),
] as const;

export async function executeHostedAgentTool<Input>(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  name: string,
  rawArguments: Input,
) {
  const input = objectInput(rawArguments);
  switch (name) {
    case "relay_channels_list":
      return workspaceOperation(env, job, principal, "channels-list");
    case "relay_workspace_members":
      return workspaceOperation(env, job, principal, "members-list");
    case "relay_messages_list":
      return listMessages(env, job, principal, input);
    case "relay_message_post": {
      const conversationId = requiredString(input, "conversationId");
      const body = requiredString(input, "body");
      const idempotencyKey = requiredString(input, "idempotencyKey");
      const threadRootId = optionalString(input, "threadRootId");
      await publishAgentMessage(
        env,
        job,
        {
          conversationId,
          body,
          ...(threadRootId ? { threadRootId } : undefined),
        },
        await deterministicUuid(`${job.id}:${name}:${idempotencyKey}`),
      );
      return { ok: true, conversationId, threadRootId: threadRootId ?? null };
    }
    case "relay_channels_create": {
      const conversationId = requiredString(input, "conversationId");
      const command = channelCreateCommandSchema.parse({
        commandId: await deterministicUuid(
          `${job.id}:${name}:${conversationId}`,
        ),
        protocolVersion: 1,
        occurredAt: new Date().toISOString(),
        payload: {
          conversationId,
          name: requiredString(input, "name"),
          isPrivate: Boolean(input.isPrivate),
        },
      });
      return workspaceOperation(
        env,
        job,
        principal,
        "channels-create",
        command,
      );
    }
    case "relay_channels_members_add": {
      const conversationId = requiredString(input, "conversationId");
      const kind =
        input.kind === "user"
          ? "user"
          : input.kind === "agent"
            ? "agent"
            : null;
      if (!kind) throw new Error("kind must be user or agent");
      if (
        !Array.isArray(input.principalIds) ||
        input.principalIds.length === 0
      ) {
        throw new Error("principalIds must contain at least one member");
      }
      const members = input.principalIds.flatMap((principalId) =>
        isJsonString(principalId)
          ? [
              {
                kind,
                principalId,
              },
            ]
          : [],
      );
      if (members.length !== input.principalIds.length) {
        throw new Error("principalIds must contain string member ids");
      }
      const command = channelMemberAddCommandSchema.parse({
        commandId: await deterministicUuid(
          `${job.id}:${name}:${conversationId}:${kind}:${members.map((member) => member.principalId).join(",")}`,
        ),
        protocolVersion: 1,
        occurredAt: new Date().toISOString(),
        payload: { conversationId, members },
      });
      return workspaceOperation(
        env,
        job,
        principal,
        "channels-members-add",
        command,
      );
    }
    case "plugins_list":
      return { plugins: await hostedPluginCatalog(), runtime: "cloudflare-do" };
    case "plugins_recommend": {
      const conversationId = requiredString(input, "conversationId");
      const threadRootId = optionalString(input, "threadRootId");
      const idempotencyKey = requiredString(input, "idempotencyKey");
      const pluginIds = Array.isArray(input.pluginIds)
        ? [...new Set(input.pluginIds.map(String).filter(Boolean))].slice(0, 8)
        : [];
      if (pluginIds.length === 0) throw new Error("pluginIds is required");
      const catalog = await hostedPluginCatalog();
      const selected = pluginIds.map((pluginId) => {
        const plugin = catalog.find((candidate) => candidate.id === pluginId);
        if (!plugin) throw new Error(`Unknown plugin ID: ${pluginId}`);
        return plugin;
      });
      await publishAgentMessage(
        env,
        job,
        {
          conversationId,
          ...(threadRootId ? { threadRootId } : undefined),
          body:
            optionalString(input, "rationale") ??
            "Here are the plugins I recommend.",
          components: await Promise.all(
            selected.map(async (plugin) => ({
              id: await deterministicUuid(
                `${job.id}:${idempotencyKey}:${plugin.id}`,
              ),
              kind: "plugin.recommendation",
              version: 1,
              payload: {
                workspaceId: job.workspaceId,
                conversationId,
                ...(threadRootId ? { threadRootId } : undefined),
                agentId: job.agentId,
                pluginId: plugin.id,
                name: plugin.name,
                description: plugin.description,
                category: plugin.category,
                sourceType: "discovery",
                status: "available",
                enabled: false,
                trusted: false,
                domain: plugin.domain,
                ...(plugin.iconUrl ? { iconUrl: plugin.iconUrl } : undefined),
              },
            })),
          ),
        },
        await deterministicUuid(`${job.id}:${name}:${idempotencyKey}`),
      );
      return { ok: true, conversationId, pluginIds };
    }
    case "plugins_install":
    case "plugins_authorize":
    case "plugins_uninstall":
      return {
        pluginId: requiredString(input, "pluginId"),
        status: "signed_cell_required",
        reason:
          "Cloudflare hosts the durable agent and catalog cards, but provider OAuth and plugin secrets stay on a signed celld device. Open Chief on a signed phone or desktop to complete this action.",
      };
    default:
      throw new Error(`Unsupported hosted cell tool: ${name}`);
  }
}

interface HostedPlugin {
  id: string;
  name: string;
  description: string;
  category: string;
  domain: string;
  iconUrl?: string;
  status: "available";
  enabled: false;
  trusted: false;
}

interface HostedPluginCatalogDocument {
  data?: {
    slug?: string;
    name?: string;
    domain?: string;
    description?: string;
    icon?: string;
    kind?: string;
    categories?: string[];
  }[];
}

async function hostedPluginCatalog(): Promise<HostedPlugin[]> {
  const response = await fetch("https://integrations.sh/api.json", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("The plugin catalog is unavailable.");
  const document: HostedPluginCatalogDocument = await response.json();
  return (document.data ?? [])
    .flatMap((entry) => {
      if (entry.kind !== "mcp" || !entry.slug || !entry.name || !entry.domain)
        return [];
      const description = entry.description?.trim();
      return [
        {
          id: entry.slug,
          name: entry.name,
          description: nonEmptyOr(
            description,
            `Connect ${entry.name} to your Chief agents.`,
          ),
          category: entry.categories?.[0] ?? "Integration",
          domain: entry.domain,
          ...(entry.icon ? { iconUrl: entry.icon } : undefined),
          status: "available" as const,
          enabled: false as const,
          trusted: false as const,
        },
      ];
    })
    .slice(0, 60);
}

function nonEmptyOr(value: string | undefined, fallback: string) {
  if (value === undefined || value.length === 0) return fallback;
  return value;
}

export async function recentConversationMessages(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  conversationId: string,
) {
  const result = await listMessages(env, job, principal, {
    conversationId,
    limit: 40,
  });
  return messagePageSchema.parse(result).messages;
}

async function listMessages(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  input: JsonObject,
) {
  const conversationId = requiredString(input, "conversationId");
  const limit = Math.min(100, Math.max(1, Number(input.limit ?? 50)));
  const stub = env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${job.workspaceId}:${conversationId}`),
  );
  const response = await stub.fetch(
    withTrustedContext(
      new Request(`https://conversation.internal/messages?limit=${limit}`),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: job.workspaceId,
        conversationId,
      },
    ),
  );
  return responseJson(response, "Conversation messages could not be read.");
}

async function workspaceOperation(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  operation: string,
  body?: JsonValue,
) {
  const response = await env.WORKSPACES.get(
    env.WORKSPACES.idFromName(job.workspaceId),
  ).fetch(
    withTrustedContext(
      new Request("https://workspace.internal", {
        method: "POST",
        headers: {
          "x-chief-internal-operation": operation,
          ...(body ? { "content-type": "application/json" } : undefined),
        },
        ...(body ? { body: JSON.stringify(body) } : undefined),
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: job.workspaceId,
      },
    ),
  );
  return responseJson(response, `Workspace operation ${operation} failed.`);
}

async function responseJson(
  response: Response,
  fallback: string,
): Promise<JsonValue> {
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(
      response.status,
      "hosted_tool_failed",
      text || fallback,
    );
  }
  if (!text) return { ok: true };
  const value: unknown = JSON.parse(text);
  const parsed = parseJsonValue(value);
  if (parsed === undefined)
    throw new Error("Hosted tool returned invalid JSON.");
  return parsed;
}

function tool(name: string, description: string, parameters: JsonObject) {
  return { type: "function", function: { name, description, parameters } };
}

function objectInput<Input>(value: Input): JsonObject {
  if (isJsonString(value)) {
    const parsed: unknown = JSON.parse(value);
    return parseJsonObject(parsed) ?? {};
  }
  return parseJsonObject(value) ?? {};
}

function requiredString(input: JsonObject, key: string) {
  const value = input[key];
  if (!isJsonString(value) || !value.trim())
    throw new Error(`${key} is required`);
  return value.trim();
}

function optionalString(input: JsonObject, key: string) {
  const value = input[key];
  return isJsonString(value) && value.trim() ? value.trim() : undefined;
}

async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
