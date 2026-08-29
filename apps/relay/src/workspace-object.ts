import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";

import type { ConversationEvent } from "@chief/relay-contracts";
import {
  conversationEventSchema,
  conversationIdSchema,
  isJsonString,
  parseJsonObject,
  principalSchema,
  workspaceSocketTicketSchema,
} from "@chief/relay-contracts";

import { attempt, runResponse } from "./effect";
import { HttpError, json, parseJson, relayError } from "./http";
import {
  readTrustedContext,
  readTrustedIdentity,
  readTrustedWorkspaceSocketTicket,
  trustedTelemetryAttributes,
} from "./internal-context";
import { WorkspaceAccessService } from "./workspace-access-service";
import { requireWorkspaceAdministrator } from "./workspace-administration";
import { WorkspaceAgentAccessService } from "./workspace-agent-access-service";
import { dispatchWorkspaceMessage } from "./workspace-agent-dispatch";
import {
  routeWorkspaceChannel,
  routeWorkspaceDirect,
} from "./workspace-channel-router";
import { WorkspaceChannelStore } from "./workspace-channel-store";
import { routeWorkspaceData } from "./workspace-data-store";
import { WorkspaceInvitationService } from "./workspace-invitation-service";
import { WorkspaceLifecycleService } from "./workspace-lifecycle-service";
import { isMembershipGrantForPrincipal } from "./workspace-live-delivery";
import { WorkspaceLiveStore } from "./workspace-live-store";
import { WorkspaceLogService } from "./workspace-log-service";
import { initializeWorkspaceSchema } from "./workspace-schema";
import { WorkspaceSecretService } from "./workspace-secret-service";
import {
  consumeSocketAllowance,
  MAX_REPLAY_EVENTS_PER_CONNECTION,
  workspaceDataCapability,
  workspaceSocketAttachment,
} from "./workspace-socket-state";

export class WorkspaceObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      initializeWorkspaceSchema(state.storage, env);
      return Promise.resolve();
    });
  }

  fetch(request: Request) {
    const connectWebSocket = this.connectWebSocket.bind(this);
    const routeOperation = this.routeOperation.bind(this);
    const program = Effect.gen(function* () {
      if (request.headers.get("upgrade") === "websocket") {
        return yield* attempt("workspace.websocket.connect", () =>
          connectWebSocket(request),
        );
      }
      const operation = request.headers.get("x-chief-internal-operation");
      const readsSecret =
        request.method === "GET" &&
        (operation === "secret-get" || operation === "secret-list");
      if (request.method !== "POST" && !readsSecret) {
        return relayError(405, "method_not_allowed", "Method not allowed.");
      }
      const response = yield* routeOperation(request, operation);
      return (
        response ??
        relayError(404, "not_found", "Workspace operation not found.")
      );
    });
    return runResponse(program, this.env, {
      operation: "workspace.fetch",
      attributes: trustedTelemetryAttributes(request),
      workflowId: request.headers.get("x-chief-workflow-id") ?? undefined,
    });
  }

  private routeOperation(request: Request, operation: string | null) {
    const ctx = this.ctx;
    const env = this.env;
    const routeData = this.routeData.bind(this);
    const publishLiveEvent = this.publishLiveEvent.bind(this);
    const createLiveSocketTicket = this.createLiveSocketTicket.bind(this);
    return Effect.gen(function* () {
      if (operation?.startsWith("channels-")) {
        return yield* attempt("workspace.channels", () =>
          routeWorkspaceChannel(ctx.storage, env, request, operation),
        );
      }
      if (operation === "directs-start") {
        return yield* attempt("workspace.direct.start", () =>
          routeWorkspaceDirect(ctx.storage, env, request),
        );
      }
      if (operation?.startsWith("data-")) {
        return yield* attempt("workspace.data", () =>
          routeData(request, operation),
        );
      }
      if (operation === "live-event-publish") {
        return yield* attempt("workspace.live.publish", () =>
          publishLiveEvent(request),
        );
      }
      if (operation === "live-socket-ticket") {
        return yield* attempt("workspace.live.ticket", () =>
          createLiveSocketTicket(request),
        );
      }
      if (operation === "agent-message-dispatch") {
        return yield* attempt("workspace.agent.dispatch", () =>
          dispatchWorkspaceMessage(ctx.storage, env, request),
        );
      }

      const access = new WorkspaceAccessService(ctx.storage, env);
      const agents = new WorkspaceAgentAccessService(ctx.storage, env);
      if (operation === "members-list") {
        return yield* attempt("workspace.members.list", () =>
          access.membersList(request),
        );
      }
      if (operation === "member-role-set") {
        return yield* attempt("workspace.member.role", () =>
          access.memberRoleSet(request),
        );
      }
      if (operation === "agent-config-get") {
        return yield* attempt("workspace.agent.config.get", () =>
          agents.configGet(request),
        );
      }
      if (operation === "agent-runtime-get") {
        return yield* attempt("workspace.agent.runtime.get", () =>
          agents.runtimeDescriptor(request),
        );
      }
      if (operation === "agent-config-set") {
        return yield* attempt("workspace.agent.config.set", () =>
          agents.configSet(request),
        );
      }
      if (operation === "authorize-conversation") {
        return yield* attempt("workspace.conversation.authorize", () =>
          agents.authorizeConversation(request),
        );
      }
      if (operation === "authorize-agent-runtime") {
        return yield* attempt("workspace.agent.authorize", () =>
          agents.authorizeRuntime(request),
        );
      }
      if (operation === "agent-hosting-context") {
        return yield* attempt("workspace.agent.context", () =>
          agents.hostingContext(request),
        );
      }
      if (operation === "register-agent-key") {
        return yield* attempt("workspace.agent.key.register", () =>
          access.registerAgentKey(request, readTrustedIdentity(request)),
        );
      }
      if (operation === "agent-keys") {
        return yield* attempt("workspace.agent.keys", () => access.agentKeys());
      }

      const invitations = new WorkspaceInvitationService(ctx.storage, env);
      if (operation === "invite-create") {
        return yield* attempt("workspace.invite.create", () =>
          invitations.create(request, readTrustedContext(request).principal),
        );
      }
      if (operation === "invite-preview") {
        return yield* attempt("workspace.invite.preview", () =>
          invitations.preview(request),
        );
      }
      if (operation === "invite-claim") {
        return yield* attempt("workspace.invite.claim", () =>
          invitations.claim(request, readTrustedIdentity(request).identity),
        );
      }
      if (operation === "organization-member-join") {
        return yield* attempt("workspace.organization.join", () =>
          invitations.joinOrganizationMember(
            readTrustedIdentity(request).identity,
          ),
        );
      }

      const lifecycle = new WorkspaceLifecycleService(ctx.storage, env);
      if (operation === "complete-onboarding") {
        return yield* attempt("workspace.onboarding.complete", () =>
          lifecycle.completeOnboarding(request),
        );
      }

      if (
        operation === "secret-set" ||
        operation === "secret-get" ||
        operation === "secret-list" ||
        operation === "secret-delete"
      ) {
        const secrets = new WorkspaceSecretService(ctx.storage, env);
        if (operation === "secret-set") {
          return yield* attempt("workspace.secret.set", () =>
            secrets.set(request),
          );
        }
        if (operation === "secret-get") {
          return yield* attempt("workspace.secret.get", () =>
            secrets.get(request),
          );
        }
        if (operation === "secret-list") {
          return yield* attempt("workspace.secret.list", () =>
            secrets.list(request),
          );
        }
        return yield* attempt("workspace.secret.delete", () =>
          secrets.delete(request),
        );
      }

      const context = readTrustedIdentity(request);
      if (operation === "authorize") {
        return yield* attempt("workspace.authorize", () =>
          access.authorize(context.identity),
        );
      }
      if (operation === "claim") {
        return yield* attempt("workspace.claim", () =>
          lifecycle.claim(request, context),
        );
      }
      if (operation === "create-managed") {
        return yield* attempt("workspace.create", () =>
          lifecycle.createManaged(request, context),
        );
      }
      if (operation === "snapshot") {
        return yield* attempt("workspace.snapshot", () =>
          lifecycle.snapshot(context),
        );
      }
      if (operation === "deletion-plan") {
        return yield* attempt("workspace.deletion.plan", () =>
          lifecycle.deletionPlan(context),
        );
      }
      if (operation === "delete-owned") {
        return yield* attempt("workspace.delete", () =>
          lifecycle.deleteOwned(context),
        );
      }

      const logs = new WorkspaceLogService(ctx.storage, env);
      if (operation === "record-logs") {
        return yield* attempt("workspace.logs.record", () =>
          logs.record(request),
        );
      }
      if (operation === "list-logs") {
        return yield* attempt("workspace.logs.list", () => logs.list(request));
      }
      return undefined;
    }).pipe(
      Effect.withSpan("workspace.operation", {
        attributes: { "chief.operation": operation ?? "unknown" },
      }),
    );
  }

  private async routeData(request: Request, operation: string) {
    const context = readTrustedContext(request);
    const channels = new WorkspaceChannelStore(this.ctx.storage, this.env);
    if (workspaceDataCapability(operation) === "machines.write")
      requireWorkspaceAdministrator(channels, context.principal);
    else channels.requirePrincipalMember(context.principal);
    channels.requireAgentCapability(
      context.principal,
      workspaceDataCapability(operation),
    );
    return routeWorkspaceData(
      this.ctx.storage,
      request,
      operation,
      context.principal,
      context.workspaceId,
    );
  }

  private async publishLiveEvent(request: Request) {
    const context = readTrustedContext(request);
    const source = conversationEventSchema.parse(await parseJson(request));
    if (
      source.workspaceId !== context.workspaceId ||
      source.payload.message.conversationId !== context.conversationId
    ) {
      throw new HttpError(
        409,
        "live_event_scope_mismatch",
        "The live event does not match its trusted relay scope.",
      );
    }
    const live = new WorkspaceLiveStore(this.ctx.storage);
    const event = live.publish(source);
    this.broadcastLiveEvent(event);
    return json({ sequence: event.sequence });
  }

  private async createLiveSocketTicket(request: Request) {
    const context = readTrustedContext(request);
    const channels = new WorkspaceChannelStore(this.ctx.storage, this.env);
    channels.requirePrincipalMember(context.principal);
    channels.requireAgentCapability(context.principal, "messages.read");
    const live = new WorkspaceLiveStore(this.ctx.storage);
    const ticket = await live.createSocketTicket(context.principal);
    return json(
      workspaceSocketTicketSchema.parse({
        ...ticket,
        cursor: live.currentSequence(),
      }),
      { status: 201 },
    );
  }

  private async connectWebSocket(request: Request) {
    const context = readTrustedWorkspaceSocketTicket(request);
    const live = new WorkspaceLiveStore(this.ctx.storage);
    const principalJson = await live.consumeSocketTicket(context.ticket);
    if (!principalJson) {
      return relayError(
        401,
        "invalid_socket_ticket",
        "The socket ticket is invalid or expired.",
      );
    }
    const principal = principalSchema.parse(JSON.parse(principalJson));
    const channels = new WorkspaceChannelStore(this.ctx.storage, this.env);
    channels.requirePrincipalMember(principal);
    channels.requireAgentCapability(principal, "messages.read");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({
      principal,
      conversationIds: [],
      cursor: null,
      subscribed: false,
      messageWindowStartedAt: Date.now(),
      messageCount: 0,
      subscriptionWindowStartedAt: Date.now(),
      subscriptionCount: 0,
    });
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    let attachment = consumeSocketAllowance(socket, "message");
    if (!attachment) return;
    if (message === "ping") {
      socket.send("pong");
      return;
    }
    if (!isJsonString(message)) {
      socket.close(1008, "Invalid workspace message");
      return;
    }
    try {
      const input = parseJsonObject(JSON.parse(message));
      if (!input) {
        socket.close(1008, "Invalid workspace message");
        return;
      }
      if (input.type !== "workspace.subscribe") {
        socket.close(1008, "Invalid workspace message");
        return;
      }
      attachment = consumeSocketAllowance(socket, "subscription");
      if (!attachment) return;
      if (
        !Array.isArray(input.conversationIds) ||
        input.conversationIds.length > 128 ||
        !Number.isInteger(input.after) ||
        Number(input.after) < 0
      ) {
        throw new Error("Invalid workspace subscription.");
      }
      const conversationIds = [
        ...new Set(
          input.conversationIds.map((id) => conversationIdSchema.parse(id)),
        ),
      ];
      const principal = attachment.principal;
      const channels = new WorkspaceChannelStore(this.ctx.storage, this.env);
      if (
        conversationIds.some(
          (conversationId) =>
            !channels.canReadConversation(conversationId, principal),
        )
      ) {
        socket.close(1008, "Conversation access denied");
        return;
      }
      socket.serializeAttachment({
        ...attachment,
        conversationIds,
        subscribed: true,
      });
      this.replayLiveEvents(
        socket,
        attachment.subscribed
          ? Math.max(Number(input.after), attachment.cursor ?? 0)
          : Number(input.after),
        conversationIds,
      );
    } catch {
      socket.close(1008, "Invalid workspace subscription");
    }
  }

  private replayLiveEvents(
    socket: WebSocket,
    after: number,
    conversationIds: readonly string[],
  ) {
    const live = new WorkspaceLiveStore(this.ctx.storage);
    let cursor = after;
    let lastDeliveredCursor = after;
    let delivered = 0;
    let hasMore = false;
    do {
      const remaining = MAX_REPLAY_EVENTS_PER_CONNECTION - delivered;
      const page = live.list(cursor, Math.min(200, remaining), conversationIds);
      for (const event of page.events) {
        socket.send(JSON.stringify(event));
        cursor = event.sequence;
        lastDeliveredCursor = event.sequence;
        delivered += 1;
      }
      hasMore = page.nextSequence !== null;
      cursor = page.nextSequence ?? 0;
    } while (cursor > 0 && delivered < MAX_REPLAY_EVENTS_PER_CONNECTION);
    const attachment = workspaceSocketAttachment(socket);
    socket.serializeAttachment({
      ...attachment,
      cursor: Math.max(
        attachment.cursor ?? 0,
        lastDeliveredCursor,
        live.currentSequence(),
      ),
    });
    if (hasMore) {
      socket.close(1013, "Catch-up continues on reconnect");
    }
  }

  private broadcastLiveEvent(event: ConversationEvent) {
    const conversationId = event.payload.message.conversationId;
    const channels = new WorkspaceChannelStore(this.ctx.storage, this.env);
    const serialized = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const attachment = workspaceSocketAttachment(socket);
        if (!attachment.subscribed) continue;
        socket.serializeAttachment({ ...attachment, cursor: event.sequence });
        if (
          !attachment.conversationIds.includes(conversationId) &&
          !isMembershipGrantForPrincipal(event, attachment.principal)
        ) {
          continue;
        }
        if (
          !channels.canReadConversation(conversationId, attachment.principal)
        ) {
          socket.close(1008, "Conversation access revoked");
          continue;
        }
        socket.send(serialized);
      } catch {
        socket.close(1011, "Delivery failed");
      }
    }
  }
}
