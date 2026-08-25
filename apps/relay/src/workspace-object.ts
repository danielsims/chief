import { DurableObject } from "cloudflare:workers";

import type {
  ConversationEvent,
  JsonValue,
  Principal,
} from "@chief/relay-contracts";
import {
  conversationEventSchema,
  conversationIdSchema,
  isJsonString,
  parseJsonObject,
  principalSchema,
  workspaceSocketTicketSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson, relayError } from "./http";
import {
  readTrustedContext,
  readTrustedIdentity,
  readTrustedWorkspaceSocketTicket,
} from "./internal-context";
import { WorkspaceAccessService } from "./workspace-access-service";
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
import { WorkspaceLiveStore } from "./workspace-live-store";
import { WorkspaceLogService } from "./workspace-log-service";
import { initializeWorkspaceSchema } from "./workspace-schema";
import { WorkspaceSecretService } from "./workspace-secret-service";

const MAX_REPLAY_EVENTS_PER_CONNECTION = 1_000;
const SOCKET_MESSAGE_LIMIT_PER_MINUTE = 30;
const SUBSCRIPTION_UPDATE_LIMIT_PER_MINUTE = 10;

export class WorkspaceObject extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      initializeWorkspaceSchema(state.storage, env);
      return Promise.resolve();
    });
  }

  async fetch(request: Request) {
    try {
      if (request.headers.get("upgrade") === "websocket") {
        return await this.connectWebSocket(request);
      }
      if (request.method !== "POST") {
        return relayError(405, "method_not_allowed", "Method not allowed.");
      }
      const operation = request.headers.get("x-chief-internal-operation");
      const response = await this.routeOperation(request, operation);
      return (
        response ??
        relayError(404, "not_found", "Workspace operation not found.")
      );
    } catch (error) {
      if (error instanceof HttpError) {
        return relayError(error.status, error.code, error.message);
      }
      return relayError(
        400,
        "invalid_request",
        "The workspace request is invalid.",
      );
    }
  }

  private async routeOperation(request: Request, operation: string | null) {
    if (operation?.startsWith("channels-")) {
      return routeWorkspaceChannel(
        this.ctx.storage,
        this.env,
        request,
        operation,
      );
    }
    if (operation === "directs-start") {
      return routeWorkspaceDirect(this.ctx.storage, this.env, request);
    }
    if (operation?.startsWith("data-")) {
      return this.routeData(request, operation);
    }
    if (operation === "live-event-publish") {
      return this.publishLiveEvent(request);
    }
    if (operation === "live-socket-ticket") {
      return this.createLiveSocketTicket(request);
    }
    if (operation === "agent-message-dispatch") {
      return dispatchWorkspaceMessage(this.ctx.storage, this.env, request);
    }

    const access = new WorkspaceAccessService(this.ctx.storage, this.env);
    const agents = new WorkspaceAgentAccessService(this.ctx.storage, this.env);
    if (operation === "members-list") return access.membersList(request);
    if (operation === "member-role-set") return access.memberRoleSet(request);
    if (operation === "agent-config-get") return agents.configGet(request);
    if (operation === "agent-runtime-get") {
      return agents.runtimeDescriptor(request);
    }
    if (operation === "agent-config-set") {
      return agents.configSet(request);
    }
    if (operation === "authorize-conversation") {
      return agents.authorizeConversation(request);
    }
    if (operation === "authorize-agent-runtime") {
      return agents.authorizeRuntime(request);
    }
    if (operation === "agent-hosting-context") {
      return agents.hostingContext(request);
    }
    if (operation === "register-agent-key") {
      return access.registerAgentKey(request, readTrustedIdentity(request));
    }
    if (operation === "agent-keys") return access.agentKeys();

    const invitations = new WorkspaceInvitationService(
      this.ctx.storage,
      this.env,
    );
    if (operation === "invite-create") {
      return invitations.create(request, readTrustedContext(request).principal);
    }
    if (operation === "invite-preview") return invitations.preview(request);
    if (operation === "invite-claim") {
      return invitations.claim(request, readTrustedIdentity(request).identity);
    }
    if (operation === "organization-member-join") {
      return invitations.joinOrganizationMember(
        readTrustedIdentity(request).identity,
      );
    }

    const lifecycle = new WorkspaceLifecycleService(this.ctx.storage, this.env);
    if (operation === "complete-onboarding") {
      return lifecycle.completeOnboarding(request);
    }
    const context = readTrustedIdentity(request);
    if (operation === "authorize") return access.authorize(context.identity);
    if (operation === "claim") return lifecycle.claim(request, context);
    if (operation === "create-managed") {
      return lifecycle.createManaged(request, context);
    }
    if (operation === "snapshot") return lifecycle.snapshot(context);
    if (operation === "deletion-plan") return lifecycle.deletionPlan(context);
    if (operation === "delete-owned") return lifecycle.deleteOwned(context);

    if (
      operation === "secret-set" ||
      operation === "secret-get" ||
      operation === "secret-list" ||
      operation === "secret-delete"
    ) {
      const secrets = new WorkspaceSecretService(this.ctx.storage, this.env);
      if (operation === "secret-set") return secrets.set(request);
      if (operation === "secret-get") return secrets.get(request);
      if (operation === "secret-list") return secrets.list(request);
      return secrets.delete(request);
    }

    const logs = new WorkspaceLogService(this.ctx.storage, this.env);
    if (operation === "record-logs") return logs.record(request);
    if (operation === "list-logs") return logs.list(request);
    return undefined;
  }

  private async routeData(request: Request, operation: string) {
    const context = readTrustedContext(request);
    const channels = new WorkspaceChannelStore(this.ctx.storage, this.env);
    channels.requirePrincipalMember(context.principal);
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
        if (!attachment.conversationIds.includes(conversationId)) continue;
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

interface WorkspaceSocketAttachment {
  principal: Principal;
  conversationIds: string[];
  cursor: number | null;
  subscribed: boolean;
  messageWindowStartedAt: number;
  messageCount: number;
  subscriptionWindowStartedAt: number;
  subscriptionCount: number;
}

type SocketAllowance = "message" | "subscription";

function consumeSocketAllowance(
  socket: WebSocket,
  kind: SocketAllowance,
): WorkspaceSocketAttachment | null {
  const attachment = workspaceSocketAttachment(socket);
  const now = Date.now();
  const windowKey =
    kind === "message"
      ? "messageWindowStartedAt"
      : "subscriptionWindowStartedAt";
  const countKey = kind === "message" ? "messageCount" : "subscriptionCount";
  const limit =
    kind === "message"
      ? SOCKET_MESSAGE_LIMIT_PER_MINUTE
      : SUBSCRIPTION_UPDATE_LIMIT_PER_MINUTE;
  const expired = now - attachment[windowKey] >= 60_000;
  const count = expired ? 1 : attachment[countKey] + 1;
  if (count > limit) {
    socket.close(1008, "Workspace socket rate limit exceeded");
    return null;
  }
  const next: WorkspaceSocketAttachment = {
    ...attachment,
    [windowKey]: expired ? now : attachment[windowKey],
    [countKey]: count,
  };
  socket.serializeAttachment(next);
  return next;
}

function workspaceSocketAttachment(
  socket: WebSocket,
): WorkspaceSocketAttachment {
  const value = parseJsonObject(socket.deserializeAttachment());
  if (!value) throw new Error("Workspace socket attachment is invalid.");
  return {
    principal: principalSchema.parse(value.principal),
    conversationIds: Array.isArray(value.conversationIds)
      ? value.conversationIds.map((id) => conversationIdSchema.parse(id))
      : [],
    cursor:
      value.cursor === null ||
      (Number.isInteger(value.cursor) && Number(value.cursor) >= 0)
        ? value.cursor === null
          ? null
          : Number(value.cursor)
        : null,
    subscribed: value.subscribed === true,
    messageWindowStartedAt: validTimestamp(value.messageWindowStartedAt),
    messageCount: validCount(value.messageCount),
    subscriptionWindowStartedAt: validTimestamp(
      value.subscriptionWindowStartedAt,
    ),
    subscriptionCount: validCount(value.subscriptionCount),
  };
}

function validTimestamp(value: JsonValue | undefined) {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : Date.now();
}

function validCount(value: JsonValue | undefined) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function workspaceDataCapability(operation: string) {
  if (operation === "data-brand-save") return "brand-profile-write";
  if (operation === "data-prospect-save") return "prospects-write";
  if (operation === "data-projects-list") return "projects.read";
  if (
    operation === "data-project-create" ||
    operation === "data-project-delete"
  )
    return "projects.write";
  if (operation === "data-file-save" || operation === "data-file-update")
    return "workspace.write";
  return "workspace.read";
}
