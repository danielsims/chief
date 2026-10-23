import type {
  RelayDiscovery,
  WebMachineFetchRequest,
  WebMachineFetchResult,
  WebMachinePolicy,
} from "@chief/relay-contracts";
import { webMachineFetchRequestSchema } from "@chief/relay-contracts";

import type { RelaySocket } from "./relay-client-options";
import {
  asRelayError,
  isTerminalSubscriptionError,
  relayReconnectPolicy,
  waitForSocketOpen,
} from "./relay-reconnect";

export interface RelayWebMachine {
  close: () => void;
}

type Fetched = Omit<
  Extract<WebMachineFetchResult, { ok: true }>,
  "type" | "requestId" | "ok"
>;

/**
 * Lends this computer's connection to the workspace's agents: holds a socket
 * open to the workspace and answers each fetch it's sent with `fetch`. The
 * socket reconnects on its own until closed.
 */
export async function openRelayWebMachine(input: {
  workspaceId: string;
  discovery: () => Promise<RelayDiscovery>;
  createTicket: () => Promise<{ ticket: string }>;
  createWebSocket: (url: string) => RelaySocket;
  /** Who may use this machine; sent each time it connects. */
  policy: WebMachinePolicy;
  /** Fetches one page; the request says which agent asked, for whom. */
  fetch: (
    request: Omit<WebMachineFetchRequest, "type" | "requestId">,
  ) => Promise<Fetched>;
  onError?: (error: Error) => void;
}): Promise<RelayWebMachine> {
  let closed = false;
  let generation = 0;
  let reconnectDelay: number = relayReconnectPolicy.baseDelayMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSocket: RelaySocket | null = null;

  const answer = async (
    socket: RelaySocket,
    request: WebMachineFetchRequest,
  ) => {
    const { requestId, type: _type, ...fetchRequest } = request;
    let result: WebMachineFetchResult;
    try {
      result = {
        type: "web.fetch.result",
        requestId,
        ok: true,
        ...(await input.fetch(fetchRequest)),
      };
    } catch (error) {
      result = {
        type: "web.fetch.result",
        requestId,
        ok: false,
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          500,
        ),
      };
    }
    if (socket.readyState === 1) socket.send(JSON.stringify(result));
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
    const [discovery, ticket] = await Promise.all([
      input.discovery(),
      input.createTicket(),
    ]);
    if (closed || connection !== generation) return;
    const socketUrl = new URL(discovery.websocketUrl);
    socketUrl.searchParams.set("workspaceId", input.workspaceId);
    socketUrl.searchParams.set("ticket", ticket.ticket);
    socketUrl.searchParams.set("role", "web-machine");
    const socket = input.createWebSocket(socketUrl.toString());
    activeSocket = socket;
    socket.addEventListener("message", (message) => {
      if (closed || connection !== generation) return;
      const text = String(message.data);
      if (text === "pong") return;
      try {
        const request = webMachineFetchRequestSchema.safeParse(
          JSON.parse(text),
        );
        if (request.success) void answer(socket, request.data);
      } catch {
        // Anything that isn't a fetch request is ignored.
      }
    });
    socket.addEventListener("error", () => {
      if (closed || connection !== generation) return;
      input.onError?.(new Error("The machine's relay connection failed."));
      socket.close();
    });
    socket.addEventListener("close", () => {
      if (activeSocket === socket) activeSocket = null;
      if (!closed && connection === generation) scheduleReconnect();
    });
    await waitForSocketOpen(socket);
    socket.send(
      JSON.stringify({ type: "web.machine.policy", policy: input.policy }),
    );
    reconnectDelay = relayReconnectPolicy.baseDelayMs;
  };

  await openSocket();
  return {
    close: () => {
      closed = true;
      generation += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      activeSocket?.close();
      activeSocket = null;
    },
  };
}
