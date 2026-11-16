import { z } from "zod";

import type {
  AgentJob,
  AgentPrincipal,
  JsonObject,
} from "@chief/relay-contracts";
import {
  PLUGINS_LIST_INSTRUCTION,
  recommendationPayload,
  recommendPluginsDefinition,
  resolvePlugins,
  workspacePluginCatalog,
} from "@chief/agent-runtime/local-tools";
import { isJsonString, mcpConnectionListSchema } from "@chief/relay-contracts";

import { publishAgentMessage } from "./agent-message-publisher";
import { releaseInternalResponse } from "./internal-response";
import { workspacePlugins } from "./mcp/agent-plugin-tools";

export async function executeHostedAgentPluginTool(
  env: Env,
  job: AgentJob,
  name: string,
  input: JsonObject,
  principal: AgentPrincipal,
) {
  if (name === "plugins.list") {
    const query = optionalString(input, "query")?.toLowerCase();
    const limit = Math.min(20, Math.max(1, Number(input.limit ?? 8)));
    const catalog = await hostedWorkspacePlugins(env, job, principal);
    const plugins = query
      ? catalog.filter((plugin) =>
          `${plugin.name} ${plugin.description} ${plugin.category} ${plugin.id}`
            .toLowerCase()
            .includes(query),
        )
      : catalog;
    return {
      plugins: plugins.slice(0, limit),
      total: plugins.length,
      runtime: "cloudflare-do",
      instruction: PLUGINS_LIST_INSTRUCTION,
    };
  }
  if (name === "plugins.recommend") {
    const { conversationId, threadRootId } = hostedPluginPlacement(
      job.payload,
      input,
    );
    const idempotencyKey = requiredString(input, "idempotencyKey");
    const {
      pluginIds = [],
      services = [],
      scope,
    } = recommendPluginsDefinition.inputSchema.parse(input);
    const catalog = await hostedWorkspacePlugins(env, job, principal);
    const { plugins: selected, missing } = resolvePlugins(
      catalog,
      pluginIds,
      services,
      scope,
    );
    if (missing.length)
      throw new Error(`Unknown plugins: ${missing.join(", ")}`);
    await publishAgentMessage(
      env,
      job,
      {
        conversationId,
        ...(threadRootId ? { threadRootId } : undefined),
        body: requiredString(input, "content"),
        components: await Promise.all(
          selected.map(async (plugin) => ({
            id: await deterministicUuid(
              `${job.id}:${idempotencyKey}:${plugin.id}`,
            ),
            kind: "plugin.recommendation",
            version: 1,
            payload: recommendationPayload(plugin, {
              workspaceId: job.workspaceId,
              conversationId,
              threadRootId,
              agentId: job.agentId,
            }),
          })),
        ),
      },
      await deterministicUuid(`${job.id}:${name}:${idempotencyKey}`),
    );
    return {
      ok: true,
      conversationId,
      pluginIds: selected.map((plugin) => plugin.id),
    };
  }
  throw new Error(`Unsupported plugin tool operation: ${name}`);
}

export function hostedPluginPlacement(
  jobPayload: JsonObject,
  input: JsonObject,
) {
  const conversationId =
    optionalString(jobPayload, "conversationId") ??
    requiredString(input, "channelId");
  const threadRootId = optionalString(jobPayload, "threadRootId");
  return {
    conversationId,
    ...(threadRootId ? { threadRootId } : undefined),
  };
}

const hostedPluginCatalogSchema = z.object({
  data: z
    .array(
      z.object({
        slug: z.string().optional(),
        name: z.string().optional(),
        domain: z.string().optional(),
        description: z.string().optional(),
        icon: z.string().optional(),
        kind: z.string().optional(),
        categories: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});

export async function hostedPluginCatalog() {
  const response = await fetch("https://integrations.sh/api.json", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("The plugin catalog is unavailable.");
  const document = hostedPluginCatalogSchema.parse(await response.json());
  return document.data.flatMap((entry) => {
    if (entry.kind !== "mcp" || !entry.slug || !entry.name || !entry.domain)
      return [];
    return [
      {
        id: entry.slug,
        name: entry.name,
        description:
          entry.description?.trim() ??
          `Connect ${entry.name} to your Chief agents.`,
        category: entry.categories?.[0] ?? "Integration",
        domain: entry.domain,
        domains: [entry.domain],
        source: {
          type: "discovery" as const,
          registry: "integrations.sh",
          domain: entry.domain,
        },
        status: "available" as const,
        enabled: false,
        trusted: false,
        ...(entry.icon ? { iconUrl: entry.icon } : undefined),
      },
    ];
  });
}

function requiredString(input: JsonObject, key: string) {
  const value = input[key];
  if (!isJsonString(value) || !value.trim()) {
    throw new Error(`${key} is required`);
  }
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

async function hostedWorkspacePlugins(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
) {
  const [catalog, response] = await Promise.all([
    hostedPluginCatalog(),
    workspacePlugins(env, job, principal, "mcp-list"),
  ]);
  if (!response.ok) {
    await releaseInternalResponse(response);
    throw new Error("Workspace plugin connections are unavailable.");
  }
  const { connections } = mcpConnectionListSchema.parse(await response.json());
  return workspacePluginCatalog(catalog, connections);
}
