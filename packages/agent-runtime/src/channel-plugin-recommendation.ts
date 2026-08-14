import type { AgentPluginSummary } from "@chief/plugin-api";

import type { ChannelLocalToolContext } from "./channel-local-tools.js";
import type { ChannelEvent, WorkspaceChannel } from "./channel-types.js";
import { fail, optionalText, textValue } from "./channel-local-tool-input.js";
import { resolveChannelMessageId } from "./channels/message-projection.js";
import { createChannelEvent } from "./channels/nip29.js";

const MAX_RECOMMENDATIONS = 8;

function stringList(input: unknown, name: string) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    fail(`${name} must be an array.`, 400, "invalid_plugin_recommendation");
  }
  return input
    .slice(0, MAX_RECOMMENDATIONS)
    .map((item, index) => textValue(item, `${name}[${index}]`, 120));
}

function isPluginSummary(value: unknown): value is AgentPluginSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plugin = value as Partial<AgentPluginSummary>;
  return Boolean(
    typeof plugin.id === "string" &&
    typeof plugin.name === "string" &&
    typeof plugin.description === "string" &&
    typeof plugin.category === "string" &&
    typeof plugin.status === "string" &&
    typeof plugin.enabled === "boolean" &&
    typeof plugin.trusted === "boolean" &&
    plugin.source &&
    typeof plugin.source === "object",
  );
}

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchable(plugin: AgentPluginSummary) {
  const sourceDomain =
    plugin.source.type === "discovery" ? plugin.source.domain : "";
  return normalized(
    [
      plugin.id,
      plugin.name,
      plugin.description,
      plugin.category,
      plugin.homepage,
      sourceDomain,
      ...(plugin.domains ?? []),
      ...(plugin.keywords ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function matchScore(plugin: AgentPluginSummary, query: string) {
  const target = normalized(query);
  if (!target) return 0;
  const id = normalized(plugin.id);
  const name = normalized(plugin.name);
  const domains = [
    ...(plugin.domains ?? []),
    ...(plugin.source.type === "discovery" ? [plugin.source.domain] : []),
  ].map(normalized);
  if (target === id || target === name || domains.includes(target)) return 100;
  if (name.includes(target) || target.includes(name)) return 80;
  const haystack = searchable(plugin);
  if (haystack.includes(target)) return 60;
  const tokens = target.split(" ").filter((token) => token.length > 1);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token))
    ? 40
    : 0;
}

function resolvePlugins(
  plugins: AgentPluginSummary[],
  pluginIds: string[],
  services: string[],
) {
  const selected: AgentPluginSummary[] = [];
  const selectedIds = new Set<string>();
  const missing: string[] = [];
  const add = (plugin: AgentPluginSummary | undefined, requested: string) => {
    if (!plugin) {
      missing.push(requested);
      return;
    }
    if (!selectedIds.has(plugin.id)) {
      selected.push(plugin);
      selectedIds.add(plugin.id);
    }
  };
  for (const pluginId of pluginIds) {
    add(
      plugins.find((plugin) => plugin.id === pluginId),
      pluginId,
    );
  }
  for (const service of services) {
    const ranked = plugins
      .map((plugin) => ({ plugin, score: matchScore(plugin, service) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score);
    add(ranked[0]?.plugin, service);
  }
  return { plugins: selected.slice(0, MAX_RECOMMENDATIONS), missing };
}

export async function postPluginRecommendation(input: {
  workspaceId: string;
  channel: WorkspaceChannel;
  events: ChannelEvent[];
  body: Record<string, unknown>;
  context: ChannelLocalToolContext;
}) {
  const { workspaceId, channel, events, body, context } = input;
  if (!context.plugins) {
    fail("Plugin discovery is unavailable.", 503, "plugin_api_unavailable");
  }
  const content = textValue(body.content, "content", 1_000);
  const idempotencyKey = textValue(body.idempotencyKey, "idempotencyKey", 120);
  const sourceId = `channel-api:${idempotencyKey}`;
  const existing = events.find((event) =>
    event.tags.some((tag) => tag[0] === "client" && tag[1] === sourceId),
  );
  if (existing) return { event: existing, replayed: true };

  const pluginIds = stringList(body.pluginIds, "pluginIds");
  const services = stringList(body.services, "services");
  if (pluginIds.length === 0 && services.length === 0) {
    fail(
      "Provide at least one pluginId or service.",
      400,
      "plugin_recommendation_empty",
    );
  }
  const snapshot = (await context.plugins.list(false)) as {
    plugins?: unknown[];
  };
  const catalog = Array.isArray(snapshot.plugins)
    ? snapshot.plugins.filter(isPluginSummary)
    : [];
  const resolved = resolvePlugins(catalog, pluginIds, services);
  if (resolved.plugins.length === 0) {
    fail(
      "No matching plugins were found in the current catalog.",
      404,
      "plugin_not_found",
    );
  }
  const requestedThreadRootId = optionalText(
    body.threadRootId,
    "threadRootId",
    160,
  );
  await context.beforeMessagePost?.({
    channel,
    content,
    idempotencyKey,
  });
  const event = createChannelEvent({
    workspaceId,
    channelId: channel.id,
    actor: context.actor,
    content,
    parts: [
      {
        type: "data-plugin-recommendations",
        data: { plugins: resolved.plugins },
      },
    ],
    threadRootId: requestedThreadRootId
      ? resolveChannelMessageId(events, requestedThreadRootId)
      : undefined,
    sourceId,
  });
  await context.channelStore.appendEvent(workspaceId, event);
  await context.onChannelEvent?.(event);
  await context.channelStore.audit(
    workspaceId,
    channel.id,
    "message.posted",
    context.actor,
    { eventId: event.id, kind: "plugin_recommendation" },
  );
  return {
    event,
    plugins: resolved.plugins,
    missingServices: resolved.missing,
  };
}
