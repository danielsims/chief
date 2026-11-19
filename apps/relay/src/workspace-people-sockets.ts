import type { WorkspaceSocketAttachment } from "./workspace-socket-state";
import { workspaceSocketAttachment } from "./workspace-socket-state";

/** The part of a socket this fan-out needs; lending machines don't parse. */
export type PeopleSocket = Pick<WebSocket, "deserializeAttachment" | "send">;

export interface PeopleSocketContext {
  getWebSockets: (tag?: string) => readonly PeopleSocket[];
}

/** Subscribed sockets of people, never agents or lending machines. */
export function peopleSockets(ctx: PeopleSocketContext, except?: PeopleSocket) {
  const sockets: {
    socket: PeopleSocket;
    attachment: WorkspaceSocketAttachment;
  }[] = [];
  for (const socket of ctx.getWebSockets()) {
    if (socket === except) continue;
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
export function sendToSocket(socket: PeopleSocket, event: string) {
  try {
    socket.send(event);
  } catch {
    // The socket's own close handler cleans up.
  }
}

export function sendToPeople(
  ctx: PeopleSocketContext,
  event: string,
  except?: PeopleSocket,
) {
  for (const { socket } of peopleSockets(ctx, except))
    sendToSocket(socket, event);
}
