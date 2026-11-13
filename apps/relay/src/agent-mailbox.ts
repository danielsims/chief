import {
  parseJsonObject,
  principalSchema,
  socketTicketSchema,
} from "@chief/relay-contracts";

import type { readTrustedContext } from "./internal-context";
import { requireAgentPrincipal } from "./agent-job-store";
import { HttpError, json, relayError } from "./http";
import { readTrustedAgentSocketTicket } from "./internal-context";
import { consumeSocketTicket, createSocketTicket } from "./socket-ticket-store";
import { reportAgentHost } from "./workspace-presence";

export async function createAgentMailboxSocketTicket(
  storage: DurableObjectStorage,
  request: Request,
  context: ReturnType<typeof readTrustedContext>,
) {
  requireAgentPrincipal(context.principal);
  const agentId = new URL(request.url).searchParams.get("agentId");
  if (agentId !== context.principal.agentId) {
    throw new HttpError(
      403,
      "agent_mailbox_access_denied",
      "An agent can only subscribe to its own mailbox.",
    );
  }
  return json(
    socketTicketSchema.parse(
      await createSocketTicket(storage, context.principal),
    ),
    { status: 201 },
  );
}

export async function connectAgentMailboxWebSocket(
  state: DurableObjectState,
  env: Env,
  request: Request,
) {
  const context = readTrustedAgentSocketTicket(request);
  const principalJson = await consumeSocketTicket(
    state.storage,
    context.ticket,
  );
  if (!principalJson) {
    return relayError(
      401,
      "invalid_socket_ticket",
      "The socket ticket is invalid or expired.",
    );
  }
  const principal = principalSchema.parse(JSON.parse(principalJson));
  if (principal.kind !== "agent" || principal.agentId !== context.agentId) {
    return relayError(
      403,
      "agent_mailbox_access_denied",
      "The socket ticket does not belong to this agent.",
    );
  }
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.serializeAttachment({ principal });
  state.acceptWebSocket(server);
  state.waitUntil(reportAgentHost(env, principal, true));
  return new Response(null, { status: 101, webSocket: client });
}

/** The host is offline once its last mailbox socket is gone. */
export async function closeAgentMailboxWebSocket(
  state: DurableObjectState,
  env: Env,
  socket: WebSocket,
) {
  const principal = principalSchema.safeParse(
    parseJsonObject(socket.deserializeAttachment())?.principal,
  );
  if (!principal.success || principal.data.kind !== "agent") return;
  if (state.getWebSockets().some((peer) => peer !== socket)) return;
  await reportAgentHost(env, principal.data, false);
}
