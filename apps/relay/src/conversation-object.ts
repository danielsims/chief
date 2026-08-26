import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";

import type {
  JsonObject,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  appendMessageResultSchema,
  deleteMessageResultSchema,
  editMessagePayloadSchema,
  editMessageResultSchema,
  messageIdSchema,
  principalSchema,
  reactToMessagePayloadSchema,
  socketTicketSchema,
} from "@chief/relay-contracts";

import { upsertConversationActivity } from "./conversation-activity";
import { publishConversationWorkspaceEvent } from "./conversation-live";
import { authorFor, reactorPubkey } from "./conversation-principals";
import {
  conversationWorkflowId,
  parseConversationPageInteger,
} from "./conversation-request";
import { SqlConversationStore } from "./conversation-store";
import { attempt, runResponse, sync, telemetryIncludesContent } from "./effect";
import { HttpError, json, parseJson, relayError } from "./http";
import {
  readTrustedContext,
  readTrustedSocketTicket,
  requiredTrustedConversationId,
  trustedTelemetryAttributes,
} from "./internal-context";
import { recordMetrics } from "./metrics";
import { validatePluginComponentPlacement } from "./plugin-component-policy";

const repliesRoute = /\/messages\/([^/]+)\/replies$/u;
const reactionsRoute = /\/messages\/([^/]+)\/reactions$/u;
const editRoute = /\/messages\/([^/]+)\/edit$/u;
const deleteRoute = /\/messages\/([^/]+)$/u;
const activityRoute = /\/messages\/([^/]+)\/activity$/u;
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
    const ctx = this.ctx;
    const env = this.env;
    const workflowId = await conversationWorkflowId(request);
    const connectWebSocket = this.connectWebSocket.bind(this);
    const listEvents = this.listEvents.bind(this);
    const listReplies = this.replies.bind(this);
    const listReactions = this.reactions.bind(this);
    const listMessages = this.listMessages.bind(this);
    const createSocketTicket = this.createSocketTicket.bind(this);
    const react = this.react.bind(this);
    const upsertActivity = (
      activityRequest: Request,
      activityContext: ReturnType<typeof readTrustedContext>,
      messageId: string,
    ) =>
      upsertConversationActivity({
        request: activityRequest,
        context: activityContext,
        messageId,
        store: this.store,
        broadcast: this.broadcast.bind(this),
        publishWorkspaceEvent: (event, eventContext) =>
          publishConversationWorkspaceEvent(
            this.ctx,
            this.env,
            event,
            eventContext.principal,
            eventContext.workspaceId,
            requiredTrustedConversationId(eventContext),
            eventContext.requestId,
          ),
      });
    const editMessage = this.edit.bind(this);
    const deleteMessage = this.deleteMessage.bind(this);
    const append = this.append.bind(this);
    const program = Effect.gen(function* () {
      if (request.headers.get("x-chief-internal-operation") === "delete-all") {
        yield* sync("conversation.identity", () => readTrustedContext(request));
        yield* attempt("conversation.delete_all", () =>
          ctx.storage.deleteAll(),
        );
        return new Response(null, { status: 204 });
      }
      if (request.headers.get("upgrade") === "websocket") {
        return yield* attempt("conversation.websocket.connect", () =>
          connectWebSocket(request),
        );
      }
      const context = yield* sync("conversation.context", () => {
        const value = readTrustedContext(request);
        if (!value.conversationId) {
          throw new HttpError(
            400,
            "missing_conversation",
            "Conversation context is required.",
          );
        }
        return value;
      });
      if (request.method === "GET") {
        const pathname = new URL(request.url).pathname;
        if (pathname.endsWith("/events")) {
          return yield* sync("conversation.events.list", () =>
            listEvents(request),
          );
        }
        const replies = repliesRoute.exec(pathname);
        if (replies) {
          return yield* sync("conversation.replies.list", () =>
            listReplies(request, replies[1] ?? ""),
          );
        }
        const reactions = reactionsRoute.exec(pathname);
        if (reactions) {
          return yield* sync("conversation.reactions.list", () =>
            listReactions(reactions[1] ?? ""),
          );
        }
        return yield* sync("conversation.messages.list", () =>
          listMessages(request),
        );
      }
      if (request.method === "POST" || request.method === "DELETE") {
        const pathname = new URL(request.url).pathname;
        if (pathname.endsWith("/socket-tickets")) {
          return yield* attempt("conversation.socket_ticket.create", () =>
            createSocketTicket(context.principal),
          );
        }
        const reactions = reactionsRoute.exec(pathname);
        if (reactions) {
          return yield* attempt("conversation.reaction.write", () =>
            react(
              request,
              context,
              reactions[1] ?? "",
              request.method === "POST",
            ),
          );
        }
        if (request.method === "POST") {
          const activity = activityRoute.exec(pathname);
          if (activity) {
            return yield* attempt("conversation.activity.upsert", () =>
              upsertActivity(request, context, activity[1] ?? ""),
            );
          }
          const edit = editRoute.exec(pathname);
          if (edit) {
            return yield* attempt("conversation.message.edit", () =>
              editMessage(request, context, edit[1] ?? ""),
            );
          }
        }
        if (request.method === "DELETE") {
          const deleteMatch = deleteRoute.exec(pathname);
          if (deleteMatch) {
            return yield* sync("conversation.message.delete", () =>
              deleteMessage(request, context, deleteMatch[1] ?? ""),
            );
          }
        }
        const response = yield* attempt("conversation.message.append", () =>
          append(
            request,
            context.principal,
            context.workspaceId,
            requiredTrustedConversationId(context),
          ),
        );
        const result = yield* attempt("conversation.message.decode", () =>
          response.clone().json(),
        );
        const message = yield* sync(
          "conversation.message.validate",
          () => appendMessageResultSchema.parse(result).message,
        );
        const attributes = {
          "chief.workspace.id": message.workspaceId,
          "chief.workflow.id": message.id,
          "gen_ai.conversation.id": message.conversationId,
          "messaging.message.id": message.id,
          "messaging.operation.name": "publish",
          ...(telemetryIncludesContent(env)
            ? { "messaging.message.body": message.body }
            : undefined),
        };
        yield* Effect.annotateCurrentSpan(attributes);
        yield* Effect.logInfo({
          event: "relay.message.received",
          ...attributes,
        });
        return response;
      }
      return relayError(405, "method_not_allowed", "Method not allowed.");
    });
    return runResponse(program, this.env, {
      operation: "conversation.fetch",
      attributes: trustedTelemetryAttributes(request),
      workflowId,
    });
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
    validatePluginComponentPlacement(
      command.payload.components,
      principal,
      workspaceId,
      conversationId,
      command.payload.threadRootId,
    );
    const result = this.store.append({
      command,
      workspaceId,
      actor: principal,
      author: authorFor(principal),
    });
    if (!result.duplicate) {
      this.broadcast(result.event);
      publishConversationWorkspaceEvent(
        this.ctx,
        this.env,
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
    const after = parseConversationPageInteger(
      url.searchParams.get("after"),
      0,
      0,
    );
    const limit = parseConversationPageInteger(
      url.searchParams.get("limit"),
      50,
      1,
      200,
    );
    const query = url.searchParams.get("q")?.trim();
    return json(this.store.list(after, limit, query));
  }

  private replies(request: Request, rootId: string) {
    const url = new URL(request.url);
    const after = parseConversationPageInteger(
      url.searchParams.get("after"),
      0,
      0,
    );
    const limit = parseConversationPageInteger(
      url.searchParams.get("limit"),
      50,
      1,
      200,
    );
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
      publishConversationWorkspaceEvent(
        this.ctx,
        this.env,
        event,
        context.principal,
        context.workspaceId,
        requiredTrustedConversationId(context),
        context.requestId,
      );
    }
    return json(result);
  }

  private listEvents(request: Request) {
    const url = new URL(request.url);
    const after = parseConversationPageInteger(
      url.searchParams.get("after"),
      0,
      0,
    );
    const limit = parseConversationPageInteger(
      url.searchParams.get("limit"),
      50,
      1,
      200,
    );
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
      publishConversationWorkspaceEvent(
        this.ctx,
        this.env,
        event,
        context.principal,
        context.workspaceId,
        requiredTrustedConversationId(context),
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
      publishConversationWorkspaceEvent(
        this.ctx,
        this.env,
        event,
        context.principal,
        context.workspaceId,
        requiredTrustedConversationId(context),
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

  private broadcast(event: JsonObject) {
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
