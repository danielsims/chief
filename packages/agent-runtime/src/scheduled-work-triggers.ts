import type { ScheduledWorkTrigger } from "@chief/channel-api";

import type { ChannelEvent } from "./channel-types.js";
import type { SessionManager } from "./manager.js";
import type { ScheduledWorkRunner } from "./scheduled-work-local-tools.js";
import { actorPubkey } from "./channels/nip29.js";

function channelId(event: ChannelEvent) {
  return event.tags.find((tag) => tag[0] === "h")?.[1] ?? event.channelId;
}

function targetId(event: ChannelEvent) {
  return event.tags.find((tag) => tag[0] === "e")?.[1];
}

function eventMatchesTrigger(
  event: ChannelEvent,
  trigger: ScheduledWorkTrigger,
  workspaceId: string,
) {
  if (trigger.type === "channel_message") {
    const authorTypes = trigger.authorTypes ?? ["user"];
    return (
      event.kind === 9 &&
      channelId(event) === trigger.channelId &&
      authorTypes.includes(event.actor.type) &&
      (!trigger.contains ||
        event.content.toLowerCase().includes(trigger.contains.toLowerCase()))
    );
  }
  if (trigger.type === "channel_mention") {
    const memberId = trigger.memberId;
    return (
      event.kind === 9 &&
      channelId(event) === trigger.channelId &&
      (!memberId ||
        event.tags.some(
          (tag) =>
            tag[0] === "p" &&
            tag[1] ===
              actorPubkey(workspaceId, {
                type: "agent",
                id: memberId,
                name: memberId,
              }),
        ))
    );
  }
  if (trigger.type === "reaction_added") {
    return (
      event.kind === 7 &&
      channelId(event) === trigger.channelId &&
      (!trigger.emoji || event.content === trigger.emoji)
    );
  }
  return false;
}

export async function dispatchScheduledWorkEvent(input: {
  workspaceId: string;
  event: ChannelEvent;
  manager: SessionManager;
  runner: ScheduledWorkRunner;
}) {
  if (![7, 9].includes(input.event.kind)) return;
  const scheduledWork = (
    await input.manager.workspaceData(input.workspaceId)
  ).recurringWork.filter((work) => {
    if (work.status !== "active" || !work.grant || !work.trigger) return false;
    return eventMatchesTrigger(input.event, work.trigger, input.workspaceId);
  });
  await Promise.allSettled(
    scheduledWork.map((work) =>
      input.runner.runTriggered(
        input.workspaceId,
        work.id,
        `channel-event:${input.event.id}`,
        {
          type: work.trigger?.type,
          channelId: input.event.channelId,
          eventId: input.event.id,
          targetEventId: targetId(input.event),
          author: input.event.actor,
          content: input.event.content.slice(0, 8_000),
          createdAt: input.event.createdAt,
        },
      ),
    ),
  );
}
