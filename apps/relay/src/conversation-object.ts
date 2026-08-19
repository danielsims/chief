import { DurableObject } from "cloudflare:workers";

import type {
  MessageAuthor,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  principalSchema,
  socketTicketSchema,
} from "@chief/relay-contracts";

import { SqlConversationStore } from "./conversation-store";
import { HttpError, json, parseJson, relayError } from "./http";
import {
  readTrustedContext,
  readTrustedSocketTicket,
} from "./internal-context";

export class ConversationObject extends DurableObject<Env> {
  private readonly store: SqlConversationStore;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.store = new SqlConversationStore(state.storage);
    void state.blockConcurrencyWhile(() => {
      this.store.initialize();
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    try {
      if (request.headers.get("upgrade") === "websocket") {
        return await this.connectWebSocket(request);
      }
      const context = readTrustedContext(request);
      if (!context.conversationId) {
        throw new HttpError(
          400,
          "missing_conversation",
          "Conversation context is required.",
        );
      }
      if (request.method === "GET") {
        return new URL(request.url).pathname.endsWith("/events")
          ? this.listEvents(request)
          : this.listMessages(request);
      }
      if (request.method === "POST") {
        if (new URL(request.url).pathname.endsWith("/socket-tickets")) {
          return await this.createSocketTicket(context.principal);
        }
        return await this.append(
          request,
          context.principal,
          context.workspaceId,
          context.conversationId,
        );
      }
      return relayError(405, "method_not_allowed", "Method not allowed.");
    } catch (error) {
      if (error instanceof HttpError) {
        return relayError(
          error.status,
          error.code,
          error.message,
          undefined,
          error.details,
        );
      }
      return relayError(
        400,
        "invalid_request",
        "The relay request is invalid.",
      );
    }
  }

  private async append(
    request: Request,
    principal: Principal,
    workspaceId: WorkspaceId,
    conversationId: string,
  ) {
    const command = appendMessageCommandSchema.parse(await parseJson(request));
    if (command.payload.conversationId !== conversationId) {
      throw new HttpError(
        409,
        "conversation_mismatch",
        "The message does not belong to the routed conversation.",
      );
    }
    const result = this.store.append({
      command,
      workspaceId,
      actor: principal,
      author: authorFor(principal),
    });
    if (!result.duplicate) this.broadcast(result.event);
    return json({ duplicate: result.duplicate, message: result.message });
  }

  private listMessages(request: Request) {
    const url = new URL(request.url);
    const after = parseInteger(url.searchParams.get("after"), 0, 0);
    const limit = parseInteger(url.searchParams.get("limit"), 50, 1, 200);
    return json(this.store.list(after, limit));
  }

  private listEvents(request: Request) {
    const url = new URL(request.url);
    const after = parseInteger(url.searchParams.get("after"), 0, 0);
    const limit = parseInteger(url.searchParams.get("limit"), 50, 1, 200);
    return json(this.store.listEvents(after, limit));
  }

  private async createSocketTicket(principal: Principal) {
    return json(
      socketTicketSchema.parse(await this.store.createSocketTicket(principal)),
      { status: 201 },
    );
  }

  private async connectWebSocket(request: Request) {
    const context = readTrustedSocketTicket(request);
    const principalJson = await this.store.consumeSocketTicket(context.ticket);
    if (!principalJson) {
      return relayError(
        401,
        "invalid_socket_ticket",
        "The socket ticket is invalid or expired.",
      );
    }
    principalSchema.parse(JSON.parse(principalJson));
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(event: Record<string, unknown>) {
    const serialized = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(serialized);
      } catch {
        socket.close(1011, "Delivery failed");
      }
    }
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") socket.send("pong");
  }
}

function authorFor(principal: Principal): MessageAuthor {
  if (principal.kind === "user") return { kind: "user", id: principal.userId };
  if (principal.kind === "agent")
    return { kind: "agent", id: principal.agentId };
  return { kind: "system", id: "chief-relay" };
}

function parseInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(
      400,
      "invalid_pagination",
      "Pagination values are invalid.",
    );
  }
  return parsed;
}
