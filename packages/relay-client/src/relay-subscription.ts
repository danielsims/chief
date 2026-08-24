import type { ConversationEvent, RelayDiscovery } from "@chief/relay-contracts";
import { conversationEventSchema } from "@chief/relay-contracts";

import type { RelaySocket } from "./relay-client-options";
import {
  asRelayError,
  isTerminalSubscriptionError,
  relayReconnectPolicy,
  waitForSocketOpen,
} from "./relay-reconnect";

export interface RelayConversationSubscription {
  close: () => void;
  cursor: () => number;
}

export async function openRelayConversationSubscription(input: {
  workspaceId: string;
  conversationId: string;
  after?: number;
  discovery: () => Promise<RelayDiscovery>;
  createTicket: () => Promise<{ ticket: string }>;
  listEvents: (after: number) => Promise<{
    events: ConversationEvent[];
    nextSequence: number | null;
  }>;
  createWebSocket: (url: string) => RelaySocket;
  onEvent: (event: ConversationEvent) => void;
  onError?: (error: Error) => void;
}): Promise<RelayConversationSubscription> {
  let cursor = input.after ?? 0;
  let closed = false;
  let started = false;
  let generation = 0;
  let reconnectDelay: number = relayReconnectPolicy.baseDelayMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSocket: RelaySocket | null = null;

  const clearStabilityTimer = () => {
    if (!stabilityTimer) return;
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  };
  const accept = (event: ConversationEvent) => {
    if (event.sequence <= cursor || closed) return;
    cursor = event.sequence;
    input.onEvent(event);
  };
  const catchUp = async (pending: ConversationEvent[]) => {
    let next = cursor;
    do {
      const page = await input.listEvents(next);
      for (const event of page.events) accept(event);
      next = page.nextSequence ?? 0;
    } while (next > 0);
    [...pending]
      .sort((left, right) => left.sequence - right.sequence)
      .forEach(accept);
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(
      reconnectDelay * 2,
      relayReconnectPolicy.maxDelayMs,
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void openSocket().catch((error: Error) => {
        const cause = asRelayError(
          error instanceof Error ? error : String(error),
        );
        input.onError?.(cause);
        if (isTerminalSubscriptionError(cause)) {
          closed = true;
          return;
        }
        scheduleReconnect();
      });
    }, delay);
  };

  const openSocket = async () => {
    const connection = ++generation;
    const [discovery, ticket] = await Promise.all([
      input.discovery(),
      input.createTicket(),
    ]);
    if (closed || connection !== generation) return;
    const socketUrl = new URL(discovery.websocketUrl);
    socketUrl.searchParams.set("workspaceId", input.workspaceId);
    socketUrl.searchParams.set("conversationId", input.conversationId);
    socketUrl.searchParams.set("ticket", ticket.ticket);

    let catchingUp = true;
    const pending: ConversationEvent[] = [];
    const socket = input.createWebSocket(socketUrl.toString());
    activeSocket = socket;
    socket.addEventListener("message", (message) => {
      if (closed || connection !== generation) return;
      try {
        const event = conversationEventSchema.parse(
          JSON.parse(String(message.data)),
        );
        if (catchingUp) pending.push(event);
        else accept(event);
      } catch (error) {
        input.onError?.(
          asRelayError(error instanceof Error ? error : String(error)),
        );
      }
    });
    socket.addEventListener("error", () => {
      if (closed || connection !== generation) return;
      input.onError?.(new Error("The relay live connection failed."));
      socket.close();
    });
    socket.addEventListener("close", () => {
      clearStabilityTimer();
      if (activeSocket === socket) activeSocket = null;
      if (started && !closed && connection === generation) scheduleReconnect();
    });

    await waitForSocketOpen(socket);
    if (connection !== generation) {
      socket.close();
      return;
    }
    try {
      await catchUp(pending);
      catchingUp = false;
      clearStabilityTimer();
      stabilityTimer = setTimeout(() => {
        if (!closed && connection === generation && activeSocket === socket) {
          reconnectDelay = relayReconnectPolicy.baseDelayMs;
        }
        stabilityTimer = null;
      }, relayReconnectPolicy.stableResetMs);
    } catch (error) {
      socket.close();
      throw error;
    }
  };

  await openSocket();
  started = true;
  return {
    close: () => {
      closed = true;
      generation += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearStabilityTimer();
      activeSocket?.close();
      activeSocket = null;
    },
    cursor: () => cursor,
  };
}
