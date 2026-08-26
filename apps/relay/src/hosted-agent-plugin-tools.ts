import { z } from "zod";

import type { AgentJob, JsonObject } from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";

import { publishAgentMessage } from "./agent-message-publisher";

export async function executeHostedAgentPluginTool(
  env: Env,
  job: AgentJob,
  name: string,
  input: JsonObject,
) {
  if (name === "plugins.list") {
    const query = optionalString(input, "query")?.toLowerCase();
    const limit = Math.min(20, Math.max(1, Number(input.limit ?? 8)));
    const catalog = await hostedPluginCatalog();
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
    };
  }
  if (name === "plugins.recommend") {
    const { conversationId, threadRootId } = hostedPluginPlacement(
      job.payload,
      input,
    );
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
        body: requiredString(input, "content"),
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

interface HostedPlugin {
  id: string;
  name: string;
  description: string;
  category: string;
  domain: string;
  iconUrl?: string;
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

async function hostedPluginCatalog(): Promise<HostedPlugin[]> {
  const response = await fetch("https://integrations.sh/api.json", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("The plugin catalog is unavailable.");
  const document = hostedPluginCatalogSchema.parse(await response.json());
  return document.data
    .flatMap((entry) => {
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
          ...(entry.icon ? { iconUrl: entry.icon } : undefined),
        },
      ];
    })
    .slice(0, 60);
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
