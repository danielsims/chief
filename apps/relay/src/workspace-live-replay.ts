import { WorkspaceLiveStore } from "./workspace-live-store";
import {
  MAX_REPLAY_EVENTS_PER_CONNECTION,
  workspaceSocketAttachment,
} from "./workspace-socket-state";

/** Catches a subscribing socket up on the live events it missed. */
export function replayLiveEvents(
  storage: DurableObjectStorage,
  socket: WebSocket,
  after: number,
  conversationIds: readonly string[],
) {
  const live = new WorkspaceLiveStore(storage);
  let cursor = after;
  let lastDeliveredCursor = after;
  let delivered = 0;
  let hasMore = false;
  do {
    const remaining = MAX_REPLAY_EVENTS_PER_CONNECTION - delivered;
    const page = live.list(cursor, Math.min(200, remaining), conversationIds);
    for (const event of page.events) {
      socket.send(JSON.stringify(event));
      cursor = event.sequence;
      lastDeliveredCursor = event.sequence;
      delivered += 1;
    }
    hasMore = page.nextSequence !== null;
    cursor = page.nextSequence ?? 0;
  } while (cursor > 0 && delivered < MAX_REPLAY_EVENTS_PER_CONNECTION);
  const attachment = workspaceSocketAttachment(socket);
  socket.serializeAttachment({
    ...attachment,
    cursor: Math.max(
      attachment.cursor ?? 0,
      lastDeliveredCursor,
      live.currentSequence(),
    ),
  });
  if (hasMore) {
    socket.close(1013, "Catch-up continues on reconnect");
  }
}
