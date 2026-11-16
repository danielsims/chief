import type { JsonObject } from "@chief/relay-contracts";

import type { ChannelLocalToolContext } from "./channel-local-tools.js";
import type { ChannelEvent, WorkspaceChannel } from "./channel-types.js";
import { normalizeAgentText } from "./agent-output.js";
import { fail, optionalText } from "./channel-local-tool-input.js";
import { resolveChannelMessageId } from "./channels/message-projection.js";
import { createChannelEvent } from "./channels/nip29.js";
import { resolvePlugins } from "./plugin-recommendation.js";
import { recommendPluginsDefinition } from "./tools/toolkits/plugins/recommend-plugins.js";

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
  const {
    content: text,
    idempotencyKey,
    pluginIds = [],
    services = [],
    scope,
  } = recommendPluginsDefinition.inputSchema.parse(body);
  const content = normalizeAgentText(text);
  const sourceId = `channel-api:${idempotencyKey}`;
  const existing = events.find((event) =>
    event.tags.some((tag) => tag[0] === "client" && tag[1] === sourceId),
  );
  if (existing) return { event: existing, replayed: true };

  const snapshot = await context.plugins.list(false);
  const resolved = resolvePlugins(snapshot.plugins, pluginIds, services, scope);
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
