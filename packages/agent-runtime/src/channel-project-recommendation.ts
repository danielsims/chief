import type { JsonObject } from "@chief/relay-contracts";

import type { ChannelLocalToolContext } from "./channel-local-tools.js";
import type { ChannelEvent, WorkspaceChannel } from "./channel-types.js";
import { normalizeAgentText } from "./agent-output.js";
import { optionalText, textValue } from "./channel-local-tool-input.js";
import { resolveChannelMessageId } from "./channels/message-projection.js";
import { createChannelEvent } from "./channels/nip29.js";

function optionalUrl(input: JsonObject, name: string) {
  const value = optionalText(input[name], name, 2_048);
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export async function postProjectRecommendation(input: {
  workspaceId: string;
  channel: WorkspaceChannel;
  events: ChannelEvent[];
  body: JsonObject;
  context: ChannelLocalToolContext;
}) {
  const { workspaceId, channel, events, body, context } = input;
  const content = normalizeAgentText(textValue(body.content, "content", 1_000));
  const idempotencyKey = textValue(body.idempotencyKey, "idempotencyKey", 120);
  const sourceId = `channel-api:${idempotencyKey}`;
  const existing = events.find((event) =>
    event.tags.some((tag) => tag[0] === "client" && tag[1] === sourceId),
  );
  if (existing) return { event: existing, replayed: true };

  const requestedThreadRootId = optionalText(
    body.threadRootId,
    "threadRootId",
    160,
  );
  const remoteUrl = optionalUrl(body, "remoteUrl");
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
        type: "data-project-recommendation",
        data: {
          title: "Connect a repository",
          description: "Add the Git repository this workspace should work in.",
          ...(remoteUrl ? { remoteUrl } : undefined),
        },
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
    { eventId: event.id, kind: "project_recommendation" },
  );
  return { event, replayed: false };
}
