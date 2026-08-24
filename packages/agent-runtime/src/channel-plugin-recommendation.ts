import type { AgentPluginSummary } from "@chief/plugin-api";
import type { JsonObject, JsonValue } from "@chief/relay-contracts";

import type { ChannelLocalToolContext } from "./channel-local-tools.js";
import type { ChannelEvent, WorkspaceChannel } from "./channel-types.js";
import { normalizeAgentText } from "./agent-output.js";
import { fail, optionalText, textValue } from "./channel-local-tool-input.js";
import { resolveChannelMessageId } from "./channels/message-projection.js";
import { createChannelEvent } from "./channels/nip29.js";

const MAX_RECOMMENDATIONS = 8;
const DOMAIN_IN_SERVICE = /\(([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\)\s*$/i;

function stringList(input: JsonValue | undefined, name: string) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    fail(`${name} must be an array.`, 400, "invalid_plugin_recommendation");
  }
  return input
    .slice(0, MAX_RECOMMENDATIONS)
    .map((item, index) => textValue(item, `${name}[${index}]`, 120));
}

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchable(plugin: AgentPluginSummary) {
  const sourceDomain =
    plugin.source.type === "discovery" || plugin.source.type === "setup"
      ? plugin.source.domain
      : "";
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
    ...(plugin.source.type === "discovery" || plugin.source.type === "setup"
      ? [plugin.source.domain]
      : []),
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

function setupFallback(service: string): AgentPluginSummary | undefined {
  const match = DOMAIN_IN_SERVICE.exec(service);
  const domain = match?.[1]?.toLowerCase();
  if (!match || !domain?.includes(".")) return undefined;
  const name = service.slice(0, match.index).trim();
  if (!name) return undefined;
  return {
    id: `setup-${domain.replace(/[^a-z0-9]+/g, "-")}`,
    name,
    description: `Connect ${name} through Chief's secure setup flow.`,
    category: "Productivity",
    homepage: `https://${domain}`,
    domains: [domain],
    source: { type: "setup", domain },
    status: "available",
    enabled: false,
    trusted: false,
  };
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
    add(ranked[0]?.plugin ?? setupFallback(service), service);
  }
  return { plugins: selected.slice(0, MAX_RECOMMENDATIONS), missing };
}

export async function postPluginRecommendation(input: {
  workspaceId: string;
  channel: WorkspaceChannel;
  events: ChannelEvent[];
  body: JsonObject;
  context: ChannelLocalToolContext;
}) {
  const { workspaceId, channel, events, body, context } = input;
  if (!context.plugins) {
    fail("Plugin discovery is unavailable.", 503, "plugin_api_unavailable");
  }
  const content = normalizeAgentText(textValue(body.content, "content", 1_000));
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
  const snapshot = await context.plugins.list(false);
  const resolved = resolvePlugins(snapshot.plugins, pluginIds, services);
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
