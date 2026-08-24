import type { ChannelEvent } from "@chief/agent-runtime/types";
import { isJsonString } from "@chief/relay-contracts";

import type {
  ChannelReadStateBlob,
  ObservedChannelMessage,
} from "./channel-read-state";
import {
  EMPTY_CHANNEL_READ_STATE,
  observedChannelMessage,
  parseChannelReadState,
} from "./channel-read-state";

export const MAX_SEEN_LIVE_EVENTS = 500;

export function recordSeenChannelEvent(seen: Set<string>, eventId: string) {
  seen.add(eventId);
  if (seen.size <= MAX_SEEN_LIVE_EVENTS) return;
  const oldest = seen.values().next().value;
  if (isJsonString(oldest)) seen.delete(oldest);
}

function storageKey(workspaceId: string, readerId: string) {
  return `chief:channel-read-state:v1:${workspaceId}:${readerId}`;
}

export function readChannelState(workspaceId: string, readerId: string) {
  try {
    return parseChannelReadState(
      JSON.parse(
        window.localStorage.getItem(storageKey(workspaceId, readerId)) ??
          "null",
      ) as unknown,
    );
  } catch {
    return EMPTY_CHANNEL_READ_STATE;
  }
}

export function writeChannelState(
  workspaceId: string,
  readerId: string,
  state: ChannelReadStateBlob,
) {
  try {
    window.localStorage.setItem(
      storageKey(workspaceId, readerId),
      JSON.stringify(state),
    );
  } catch {
    // History reconstructs this cache when local storage is unavailable.
  }
}

export function channelMessagesFrom(events: readonly ChannelEvent[]) {
  const sourceIds = new Map<string, string>();
  for (const event of events) {
    const sourceId = event.tags.find((tag) => tag[0] === "client")?.[1];
    if (event.kind === 9 && sourceId) sourceIds.set(event.id, sourceId);
  }
  return new Map(
    events.flatMap((event): [string, ObservedChannelMessage][] => {
      const message = observedChannelMessage(event);
      if (!message) return [];
      return [
        [
          message.id,
          {
            ...message,
            threadSourceId: message.rootId
              ? (sourceIds.get(message.rootId) ?? message.rootId)
              : null,
          },
        ],
      ];
    }),
  );
}

export function channelSourceAliasesFrom(events: readonly ChannelEvent[]) {
  const aliases = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== 9) continue;
    const sourceId = event.tags.find((tag) => tag[0] === "client")?.[1];
    if (sourceId) aliases.set(sourceId, event.id);
  }
  return aliases;
}

export function newSnapshotNotificationMessages(
  messages: Iterable<ObservedChannelMessage>,
  startedAt: number,
  notifiedIds: ReadonlySet<string>,
) {
  return [...messages].filter(
    (message) => message.createdAt > startedAt && !notifiedIds.has(message.id),
  );
}

export function latestChannelMessageTimestamp(
  messages: Iterable<ObservedChannelMessage>,
  predicate: (message: ObservedChannelMessage) => boolean,
) {
  let latest: number | null = null;
  for (const message of messages) {
    if (!predicate(message)) continue;
    latest =
      latest === null ? message.createdAt : Math.max(latest, message.createdAt);
  }
  return latest;
}
