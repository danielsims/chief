import type { Principal } from "@chief/relay-contracts";
import { principalSchema, socketTicketSchema } from "@chief/relay-contracts";

import type { SqlConversationStore } from "./conversation-store";
import { json, relayError } from "./http";
import { readTrustedSocketTicket } from "./internal-context";

export async function createConversationSocketTicket(
  store: SqlConversationStore,
  principal: Principal,
) {
  return json(
    socketTicketSchema.parse(await store.createSocketTicket(principal)),
    { status: 201 },
  );
}

export async function connectConversationWebSocket(
  ctx: DurableObjectState,
  store: SqlConversationStore,
  request: Request,
) {
  const context = readTrustedSocketTicket(request);
  const principalJson = await store.consumeSocketTicket(context.ticket);
  if (!principalJson) {
    return relayError(
      401,
      "invalid_socket_ticket",
      "The socket ticket is invalid or expired.",
    );
  }
  const principal = principalSchema.parse(JSON.parse(principalJson));
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  ctx.acceptWebSocket(server);
  server.serializeAttachment({
    principal,
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
  });
  return new Response(null, { status: 101, webSocket: client });
}
