import { DurableObject } from "cloudflare:workers";

import type {
  MessageAuthor,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  deleteMessageResultSchema,
  editMessagePayloadSchema,
  editMessageResultSchema,
  messageIdSchema,
  principalSchema,
  reactToMessagePayloadSchema,
  socketTicketSchema,
} from "@chief/relay-contracts";

import { SqlConversationStore } from "./conversation-store";
import { HttpError, json, parseJson, relayError } from "./http";
import {
  readTrustedContext,
  readTrustedSocketTicket,
  withTrustedContext,
} from "./internal-context";
import { recordMetrics } from "./metrics";

const repliesRoute = /\/messages\/([^/]+)\/replies$/u;
const reactionsRoute = /\/messages\/([^/]+)\/reactions$/u;
const editRoute = /\/messages\/([^/]+)\/edit$/u;
const deleteRoute = /\/messages\/([^/]+)$/u;

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
      if (request.headers.get("x-chief-internal-operation") === "delete-all") {
        readTrustedContext(request);
        await this.ctx.storage.deleteAll();
        return new Response(null, { status: 204 });
      }
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
        const pathname = new URL(request.url).pathname;
        if (pathname.endsWith("/events")) return this.listEvents(request);
        const replies = repliesRoute.exec(pathname);
        if (replies) {
          return this.replies(request, replies[1] ?? "");
        }
        const reactions = reactionsRoute.exec(pathname);
        if (reactions) return this.reactions(reactions[1] ?? "");
        return this.listMessages(request);
      }
      if (request.method === "POST" || request.method === "DELETE") {
        const pathname = new URL(request.url).pathname;
        if (pathname.endsWith("/socket-tickets")) {
          return await this.createSocketTicket(context.principal);
        }
        const reactions = reactionsRoute.exec(pathname);
        if (reactions) {
          return await this.react(
            request,
            context,
            reactions[1] ?? "",
            request.method === "POST",
          );
        }
        if (request.method === "POST") {
          const edit = editRoute.exec(pathname);
          if (edit) {
            return await this.edit(request, context, edit[1] ?? "");
          }
        }
        if (request.method === "DELETE") {
          const deleteMatch = deleteRoute.exec(pathname);
          if (deleteMatch) {
            return this.deleteMessage(request, context, deleteMatch[1] ?? "");
          }
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
    if (!result.duplicate) {
      this.broadcast(result.event);
      this.publishWorkspaceEvent(
        result.event,
        principal,
        workspaceId,
        conversationId,
        command.commandId,
      );
      recordMetrics(this.env, ["message"]);
    }
    return json({ duplicate: result.duplicate, message: result.message });
  }

  private listMessages(request: Request) {
    const url = new URL(request.url);
    const after = parseInteger(url.searchParams.get("after"), 0, 0);
    const limit = parseInteger(url.searchParams.get("limit"), 50, 1, 200);
    const query = url.searchParams.get("q")?.trim();
    return json(this.store.list(after, limit, query));
  }

  private replies(request: Request, rootId: string) {
    const url = new URL(request.url);
    const after = parseInteger(url.searchParams.get("after"), 0, 0);
    const limit = parseInteger(url.searchParams.get("limit"), 50, 1, 200);
    return json(
      this.store.replies(messageIdSchema.parse(rootId), after, limit),
    );
  }

  private reactions(messageId: string) {
    const message = this.store.getMessage(messageIdSchema.parse(messageId));
    if (!message) {
      throw new HttpError(
        404,
        "message_not_found",
        "The message was not found.",
      );
    }
    return json({ reactions: message.reactions });
  }

  private async react(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
    messageId: string,
    add: boolean,
  ) {
    const command = reactToMessagePayloadSchema.parse(await parseJson(request));
    if (command.messageId !== messageId) {
      throw new HttpError(
        409,
        "message_mismatch",
        "The reaction does not match the routed message.",
      );
    }
    const pubkey = reactorPubkey(context.principal);
    if (!pubkey) {
      throw new HttpError(
        403,
        "principal_required",
        "Only a keyed user or agent can react.",
      );
    }
    const { changed, result, event } = this.store.react({
      messageId,
      emoji: command.emoji,
      pubkey,
      add,
      actor: context.principal,
      workspaceId: context.workspaceId,
      correlationId: context.requestId,
    });
    if (changed && event) {
      this.broadcast(event);
      this.publishWorkspaceEvent(
        event,
        context.principal,
        context.workspaceId,
        requiredConversationId(context),
        context.requestId,
      );
    }
    return json(result);
  }

  private listEvents(request: Request) {
    const url = new URL(request.url);
    const after = parseInteger(url.searchParams.get("after"), 0, 0);
    const limit = parseInteger(url.searchParams.get("limit"), 50, 1, 200);
    return json(this.store.listEvents(after, limit));
  }

  private async edit(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
    messageId: string,
  ) {
    const payload = editMessagePayloadSchema.parse(await parseJson(request));
    if (payload.messageId !== messageId) {
      throw new HttpError(
        409,
        "message_mismatch",
        "The edit does not match the routed message.",
      );
    }
    this.assertCanMutate(messageId, context.principal);
    const { message, event } = this.store.edit({
      messageId,
      body: payload.body,
      actor: context.principal,
      workspaceId: context.workspaceId,
      correlationId: context.requestId,
    });
    if (event) {
      this.broadcast(event);
      this.publishWorkspaceEvent(
        event,
        context.principal,
        context.workspaceId,
        requiredConversationId(context),
        context.requestId,
      );
    }
    return json(editMessageResultSchema.parse({ message }));
  }

  private deleteMessage(
    request: Request,
    context: ReturnType<typeof readTrustedContext>,
    messageId: string,
  ) {
    messageIdSchema.parse(messageId);
    this.assertCanMutate(messageId, context.principal);
    const { message, event } = this.store.delete({
      messageId,
      actor: context.principal,
      workspaceId: context.workspaceId,
      correlationId: context.requestId,
    });
    if (event) {
      this.broadcast(event);
      this.publishWorkspaceEvent(
        event,
        context.principal,
        context.workspaceId,
        requiredConversationId(context),
        context.requestId,
      );
    }
    return json(deleteMessageResultSchema.parse({ message }));
  }

  private assertCanMutate(messageId: string, principal: Principal) {
    const message = this.store.getMessage(messageId);
    if (!message) {
      throw new HttpError(
        404,
        "message_not_found",
        "The message was not found.",
      );
    }
    const actorAuthor = authorFor(principal);
    const isAuthor =
      actorAuthor.kind === message.author.kind &&
      actorAuthor.id === message.author.id;
    const isOwner = principal.kind === "user" && principal.role === "owner";
    if (!isAuthor && !isOwner) {
      throw new HttpError(
        403,
        "message_mutation_denied",
        "Only the message author or a workspace owner can edit or delete this message.",
      );
    }
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

  private publishWorkspaceEvent(
    event: Record<string, unknown>,
    principal: Principal,
    workspaceId: WorkspaceId,
    conversationId: string,
    requestId: string,
  ) {
    const workspace = this.env.WORKSPACES.get(
      this.env.WORKSPACES.idFromName(workspaceId),
    );
    this.ctx.waitUntil(
      workspace
        .fetch(
          withTrustedContext(
            new Request("https://workspace.internal/live-events", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-chief-internal-operation": "live-event-publish",
              },
              body: JSON.stringify(event),
            }),
            {
              principal,
              requestId,
              workspaceId,
              conversationId,
            },
          ),
        )
        .then((response) => {
          if (!response.ok) {
            throw new Error("Workspace live event publication failed.");
          }
        }),
    );
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

function reactorPubkey(principal: Principal): string | undefined {
  if (principal.kind === "user" || principal.kind === "agent") {
    return principal.pubkey;
  }
  return undefined;
}

function requiredConversationId(
  context: ReturnType<typeof readTrustedContext>,
) {
  if (!context.conversationId) {
    throw new HttpError(
      400,
      "missing_conversation",
      "Conversation context is required.",
    );
  }
  return context.conversationId;
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
