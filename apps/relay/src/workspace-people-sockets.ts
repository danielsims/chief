import type { WorkspaceSocketAttachment } from "./workspace-socket-state";
import { workspaceSocketAttachment } from "./workspace-socket-state";
import { isWebMachine } from "./workspace-web-machine";

/** Subscribed sockets of people, never agents or lending machines. */
export function peopleSockets(ctx: DurableObjectState, except?: WebSocket) {
  const sockets: {
    socket: WebSocket;
    attachment: WorkspaceSocketAttachment;
  }[] = [];
  for (const socket of ctx.getWebSockets()) {
    if (socket === except || isWebMachine(ctx, socket)) continue;
    try {
      const attachment = workspaceSocketAttachment(socket);
      if (attachment.subscribed && attachment.principal.kind === "user")
        sockets.push({ socket, attachment });
    } catch {
      // A socket without a workspace attachment isn't a member's feed.
    }
  }
  return sockets;
}

/** Best-effort fan-out; real deliveries handle a bad socket. */
export function sendToSocket(socket: WebSocket, event: string) {
  try {
    socket.send(event);
  } catch {
    // The socket's own close handler cleans up.
  }
}

export function sendToPeople(
  ctx: DurableObjectState,
  event: string,
  except?: WebSocket,
) {
  for (const { socket } of peopleSockets(ctx, except))
    sendToSocket(socket, event);
}
