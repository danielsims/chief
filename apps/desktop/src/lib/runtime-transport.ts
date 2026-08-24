import type { ClientMessage, ServerMessage } from "@chief/agent-runtime/types";

export type RuntimeMessageListener = (message: ServerMessage) => void;
export type RuntimeConnectionStatus =
  "connecting" | "connected" | "disconnected";

/** UI-facing relay boundary that keeps transport and authentication out of views. */
export interface RuntimeTransport {
  setStatusListener(listener: (status: RuntimeConnectionStatus) => void): void;
  connect(): void;
  reconnectNow(): void;
  startDirectMessage(agentId: string): Promise<string>;
  send(message: ClientMessage): void;
  subscribe(listener: RuntimeMessageListener): () => void;
  destroy(): void;
}
