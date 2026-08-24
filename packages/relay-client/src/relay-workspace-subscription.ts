import type { ConversationEvent, RelayDiscovery } from "@chief/relay-contracts";
import { conversationEventSchema } from "@chief/relay-contracts";

import {
  asRelayError,
  isTerminalSubscriptionError,
  relayReconnectPolicy,
  waitForSocketOpen,
} from "./relay-reconnect";

export interface RelayWorkspaceSubscription {
  close: () => void;
  cursor: () => number;
  updateConversationIds: (conversationIds: readonly string[]) => void;
}

export async function openRelayWorkspaceSubscription(input: {
  workspaceId: string;
  conversationIds: readonly string[];
  after?: number;
  discovery: () => Promise<RelayDiscovery>;
  createTicket: () => Promise<{ ticket: string; cursor: number }>;
  createWebSocket: (url: string) => WebSocket;
  onEvent: (event: ConversationEvent) => void;
  onError?: (error: Error) => void;
}): Promise<RelayWorkspaceSubscription> {
  let cursor = input.after;
  let conversationIds = normalizedConversationIds(input.conversationIds);
  let closed = false;
  let started = false;
  let generation = 0;
  let reconnectDelay: number = relayReconnectPolicy.baseDelayMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSocket: WebSocket | null = null;

  const clearStabilityTimer = () => {
    if (!stabilityTimer) return;
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  };
  const sendSubscription = (socket: WebSocket) => {
    socket.send(
      JSON.stringify({
        type: "workspace.subscribe",
        conversationIds,
        after: cursor ?? 0,
      }),
    );
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
      void openSocket().catch((error: unknown) => {
        const cause = asRelayError(error);
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
    const connectionIsCurrent = () => !closed && connection === generation;
    const [discovery, ticket] = await Promise.all([
      input.discovery(),
      input.createTicket(),
    ]);
    if (!connectionIsCurrent()) return;
    cursor ??= ticket.cursor;
    const socketUrl = new URL(discovery.websocketUrl);
    socketUrl.searchParams.set("workspaceId", input.workspaceId);
    socketUrl.searchParams.set("ticket", ticket.ticket);
    const socket = input.createWebSocket(socketUrl.toString());
    activeSocket = socket;
    socket.addEventListener("message", (message) => {
      if (closed || connection !== generation) return;
      try {
        const event = conversationEventSchema.parse(
          JSON.parse(String(message.data)),
        );
        if (event.sequence <= (cursor ?? 0)) return;
        cursor = event.sequence;
        input.onEvent(event);
      } catch (error) {
        input.onError?.(asRelayError(error));
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
    if (!connectionIsCurrent()) {
      socket.close();
      return;
    }
    sendSubscription(socket);
    clearStabilityTimer();
    stabilityTimer = setTimeout(() => {
      if (!closed && connection === generation && activeSocket === socket) {
        reconnectDelay = relayReconnectPolicy.baseDelayMs;
      }
      stabilityTimer = null;
    }, relayReconnectPolicy.stableResetMs);
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
    cursor: () => cursor ?? 0,
    updateConversationIds: (nextIds) => {
      conversationIds = normalizedConversationIds(nextIds);
      if (activeSocket?.readyState === 1) {
        sendSubscription(activeSocket);
      }
    },
  };
}

function normalizedConversationIds(values: readonly string[]) {
  return [...new Set(values)].sort();
}
