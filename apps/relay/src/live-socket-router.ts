import type { WorkspaceId } from "@chief/relay-contracts";
import { agentIdSchema, conversationIdSchema } from "@chief/relay-contracts";

import { relayError } from "./http";
import {
  withTrustedAgentSocketTicket,
  withTrustedSocketTicket,
  withTrustedWorkspaceSocketTicket,
} from "./internal-context";

export function connectLiveSocket(
  env: Env,
  request: Request,
  requestId: string,
  workspaceId: WorkspaceId,
  url: URL,
) {
  const ticket = url.searchParams.get("ticket") ?? "";
  if (ticket.length < 43 || ticket.length > 128) {
    return relayError(
      401,
      "invalid_socket_ticket",
      "The socket ticket is invalid or expired.",
      requestId,
    );
  }
  const requestedAgentId = url.searchParams.get("agentId");
  const requestedConversationId = url.searchParams.get("conversationId");
  if (requestedAgentId && requestedConversationId) {
    return relayError(
      400,
      "ambiguous_socket_scope",
      "A live connection must select one conversation or one agent mailbox.",
      requestId,
    );
  }
  if (requestedAgentId) {
    const agentId = agentIdSchema.parse(requestedAgentId);
    return env.AGENTS.get(
      env.AGENTS.idFromName(`${workspaceId}:${agentId}`),
    ).fetch(
      withTrustedAgentSocketTicket(request, {
        ticket,
        requestId,
        workspaceId,
        agentId,
      }),
    );
  }
  if (!requestedConversationId) {
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId)).fetch(
      withTrustedWorkspaceSocketTicket(request, {
        ticket,
        requestId,
        workspaceId,
      }),
    );
  }
  const conversationId = conversationIdSchema.parse(requestedConversationId);
  return env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(`${workspaceId}:${conversationId}`),
  ).fetch(
    withTrustedSocketTicket(request, {
      ticket,
      requestId,
      workspaceId,
      conversationId,
    }),
  );
}
