import { WebSocket } from "ws";

/** Sends a serialized update only to sockets authorized for its workspace. */
export function broadcastWorkspaceSockets(
  clients: Iterable<WebSocket>,
  canReceive: (client: WebSocket) => boolean,
  message: string,
) {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && canReceive(client)) {
      client.send(message);
    }
  }
}
