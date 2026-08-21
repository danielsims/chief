import type {
  AgentDefinition,
  ChiefUIMessage,
  ClientMessage,
  ServerMessage,
  WorkspaceChannel,
} from "@chief/agent-runtime/types";
import type { RelayClient, WorkspaceSubscription } from "@chief/relay-client";
import type {
  ConversationEvent,
  ConversationMessage,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import { RelayClientError } from "@chief/relay-client";
import {
  agentIdSchema,
  appendMessageCommandSchema,
} from "@chief/relay-contracts";

import type {
  RuntimeConnectionStatus,
  RuntimeMessageListener,
  RuntimeTransport,
} from "./runtime-transport";
import {
  relayConversationId,
  workspaceChannelFromRelay,
} from "./relay-channel-adapter";
import {
  loadWorkspaceCursor,
  saveWorkspaceCursor,
} from "./relay-workspace-cursor";

const RELAY_CAPABILITY_DESCRIPTION =
  "Runs in its own isolated cell and collaborates through the Chief relay.";

export class RelayRuntimeClient implements RuntimeTransport {
  private listeners = new Set<RuntimeMessageListener>();
  private workspaceSubscription: WorkspaceSubscription | null = null;
  private pendingWorkspaceSubscription: Promise<WorkspaceSubscription> | null =
    null;
  private subscribedConversationIds = new Set<string>();
  private workspaceCursor: number | undefined;
  private conversationIdsByChat = new Map<string, string>();
  private subscriptionGeneration = 0;
  private statusListener: (status: RuntimeConnectionStatus) => void = () =>
    undefined;
  private snapshot: WorkspaceSnapshot;
  private closed = false;

  constructor(
    private readonly relay: RelayClient,
    snapshot: WorkspaceSnapshot,
  ) {
    this.snapshot = snapshot;
    this.workspaceCursor = loadWorkspaceCursor(snapshot.id);
  }

  setStatusListener(listener: (status: RuntimeConnectionStatus) => void) {
    this.statusListener = listener;
  }

  connect() {
    this.closed = false;
    this.statusListener("connecting");
    void this.refreshSnapshot()
      .then(() => this.statusListener("connected"))
      .catch((error: unknown) => {
        this.statusListener("disconnected");
        this.emitError(error);
      });
  }

  reconnectNow() {
    this.subscriptionGeneration += 1;
    this.captureAndCloseWorkspaceSubscription();
    this.pendingWorkspaceSubscription = null;
    this.connect();
    void this.ensureWorkspaceSubscription();
  }

  async startDirectMessage(agentId: string) {
    const result = await this.relay.startDirectMessage({
      kind: "agent",
      principalId: agentIdSchema.parse(agentId),
    });
    await this.listChats();
    return result.conversation.id;
  }

  send(message: ClientMessage) {
    void this.route(message).catch((error: unknown) => {
      const chatId = "chatId" in message ? message.chatId : undefined;
      this.emitError(error, chatId);
    });
  }

  subscribe(listener: RuntimeMessageListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy() {
    this.closed = true;
    this.subscriptionGeneration += 1;
    this.captureAndCloseWorkspaceSubscription();
    this.pendingWorkspaceSubscription = null;
    this.statusListener("disconnected");
  }

  private async route(message: ClientMessage) {
    if (this.closed) return;
    switch (message.type) {
      case "listAgents":
        this.emit({ type: "agents", agents: this.agentDefinitions() });
        return;
      case "listChannels":
        await this.listChannels();
        return;
      case "listChats":
        await this.listChats();
        return;
      case "listChannelEvents":
        await this.openChannelEvents(message.channelId);
        return;
      case "openChat":
        await this.openChat(
          message.chatId,
          this.conversationIdForChat(message.chatId, message.channelId),
        );
        return;
      case "observeChat":
        await this.openChat(
          message.chatId,
          this.conversationIdForChat(message.chatId),
        );
        return;
      case "sendMessage":
        await this.appendMessage(message);
        return;
      default:
        this.emitError(
          new Error(`Relay command ${message.type} is not implemented.`),
          "chatId" in message ? message.chatId : undefined,
        );
        return;
    }
  }

  private async refreshSnapshot() {
    this.snapshot = await this.relay.activeWorkspace();
  }

  private agentDefinitions(): AgentDefinition[] {
    return this.snapshot.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: RELAY_CAPABILITY_DESCRIPTION,
      instructions: "",
    }));
  }

  private async listChannels() {
    const [records, currentMemberships, allMemberships] = await Promise.all([
      this.relay.listChannels(),
      this.relay.listCurrentChannelMemberships(),
      this.relay.listChannelMemberships().catch((error: unknown) => {
        if (error instanceof RelayClientError && error.status === 403)
          return null;
        throw error;
      }),
    ]);
    const memberLists = allMemberships
      ? records.map((channel) =>
          allMemberships
            .filter((membership) => membership.conversationId === channel.id)
            .map((membership) => ({
              ...membership,
              ...(membership.kind === "agent"
                ? {
                    name: this.snapshot.agents.find(
                      (agent) => agent.id === membership.principalId,
                    )?.name,
                  }
                : {}),
            })),
        )
      : await Promise.all(
          records.map((channel) => this.relay.listChannelMembers(channel.id)),
        );
    const currentByChannel = new Map(
      currentMemberships.map((membership) => [
        membership.conversationId,
        membership,
      ]),
    );
    const channels: WorkspaceChannel[] = records.map((channel, index) =>
      workspaceChannelFromRelay(
        channel,
        memberLists[index] ?? [],
        currentByChannel.get(channel.id),
      ),
    );
    this.emit({
      type: "channels",
      workspaceId: this.snapshot.id,
      channels,
    });
    for (const membership of currentMemberships) {
      this.subscribedConversationIds.add(membership.conversationId);
    }
    for (const conversation of this.snapshot.conversations) {
      if (conversation.kind === "direct") {
        this.subscribedConversationIds.add(conversation.id);
      }
    }
    await this.ensureWorkspaceSubscription();
  }

  private async listChats() {
    await this.refreshSnapshot();
    this.emit({
      type: "chats",
      workspaceId: this.snapshot.id,
      chats: this.snapshot.conversations
        .filter((conversation) => conversation.kind === "direct")
        .map((conversation) => ({
          id: conversation.id,
          agent: agentForDirect(conversation.name, this.snapshot),
          title: conversation.name,
          lastText: conversation.lastMessage ?? "",
          lastAt: 0,
          running: false,
        })),
    });
    for (const conversation of this.snapshot.conversations) {
      if (conversation.kind === "direct") {
        this.subscribedConversationIds.add(conversation.id);
      }
    }
    await this.ensureWorkspaceSubscription();
  }

  private async openChat(chatId: string, conversationId: string) {
    this.conversationIdsByChat.set(chatId, conversationId);
    const page = await this.relay.listMessages(conversationId, { limit: 200 });
    const agentId = directAgentId(conversationId, this.snapshot);
    this.emit({
      type: "chatOpened",
      workspaceId: this.snapshot.id,
      chatId,
      visibility: "user",
      ...(agentId ? { agentId } : {}),
    });
    this.emit({
      type: "history",
      workspaceId: this.snapshot.id,
      chatId,
      messages: page.messages.map((message) => toChiefMessage(message)),
      events: [],
      running: false,
    });
    await this.subscribeConversation(conversationId);
  }

  private async openChannelEvents(conversationId: string) {
    const page = await this.relay.listMessages(conversationId, { limit: 200 });
    this.emit({
      type: "channelEvents",
      workspaceId: this.snapshot.id,
      channelId: conversationId,
      events: page.messages.map((message) =>
        toChannelEvent(message, this.snapshot),
      ),
    });
    await this.subscribeConversation(conversationId);
  }

  private async subscribeConversation(conversationId: string) {
    this.subscribedConversationIds.add(conversationId);
    this.workspaceSubscription?.updateConversationIds([
      ...this.subscribedConversationIds,
    ]);
    await this.ensureWorkspaceSubscription();
  }

  private async ensureWorkspaceSubscription() {
    if (this.closed || this.subscribedConversationIds.size === 0) return;
    if (this.workspaceSubscription) {
      this.workspaceSubscription.updateConversationIds([
        ...this.subscribedConversationIds,
      ]);
      return;
    }
    if (this.pendingWorkspaceSubscription) {
      await this.pendingWorkspaceSubscription;
      return;
    }
    const generation = this.subscriptionGeneration;
    const subscriptionPromise = this.relay.subscribeWorkspace({
      conversationIds: [...this.subscribedConversationIds],
      after: this.workspaceCursor,
      onEvent: (event) => this.handleWorkspaceEvent(event),
      onError: (error) => this.emitError(error),
    });
    this.pendingWorkspaceSubscription = subscriptionPromise;
    try {
      const subscription = await subscriptionPromise;
      if (!this.isCurrentSubscription(generation)) {
        subscription.close();
        return;
      }
      this.workspaceSubscription = subscription;
    } finally {
      if (this.pendingWorkspaceSubscription === subscriptionPromise) {
        this.pendingWorkspaceSubscription = null;
      }
    }
  }

  private isCurrentSubscription(generation: number) {
    return !this.closed && generation === this.subscriptionGeneration;
  }

  private handleWorkspaceEvent(event: ConversationEvent) {
    this.workspaceCursor = event.sequence;
    saveWorkspaceCursor(this.snapshot.id, event.sequence);
    const message = event.payload.message;
    if (
      this.snapshot.conversations.some(
        (conversation) =>
          conversation.id === message.conversationId &&
          conversation.kind === "channel",
      )
    ) {
      this.emit({
        type: "channelEvent",
        workspaceId: this.snapshot.id,
        event: toChannelEvent(message, this.snapshot),
      });
    }
    for (const [chatId, conversationId] of this.conversationIdsByChat) {
      if (conversationId !== message.conversationId) continue;
      this.emit({
        type: "message",
        workspaceId: this.snapshot.id,
        chatId,
        message: toChiefMessage(message),
      });
    }
  }

  private captureAndCloseWorkspaceSubscription() {
    if (!this.workspaceSubscription) return;
    this.workspaceCursor = this.workspaceSubscription.cursor();
    saveWorkspaceCursor(this.snapshot.id, this.workspaceCursor);
    this.workspaceSubscription.close();
    this.workspaceSubscription = null;
  }

  private async appendMessage(
    message: Extract<ClientMessage, { type: "sendMessage" }>,
  ) {
    const conversationId = this.conversationIdForChat(message.chatId);
    const command = appendMessageCommandSchema.parse({
      commandId: crypto.randomUUID(),
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        messageId: message.messageId,
        conversationId,
        ...(message.threadRootId ? { threadRootId: message.threadRootId } : {}),
        body: message.text,
        mentions: message.mentions ?? [],
        components: [],
      },
    });
    const result = await this.relay.appendMessage(conversationId, command);
    this.emit({
      type: "message",
      workspaceId: this.snapshot.id,
      chatId: message.chatId,
      message: toChiefMessage(result.message),
    });
  }

  private emit(message: ServerMessage) {
    for (const listener of this.listeners) listener(message);
  }

  private emitError(error: unknown, chatId?: string) {
    console.error("[Chief relay] Runtime request failed", error);
    this.emit({
      type: "error",
      message: publicRelayErrorMessage(error),
      ...(chatId ? { chatId } : {}),
    });
  }

  private conversationIdForChat(
    chatId: string,
    explicitConversationId?: string,
  ) {
    const resolved =
      explicitConversationId ??
      this.conversationIdsByChat.get(chatId) ??
      relayConversationId(chatId);
    this.conversationIdsByChat.set(chatId, resolved);
    return resolved;
  }
}

function publicRelayErrorMessage(error: unknown) {
  if (isIdentifierValidationError(error)) {
    return "Chief couldn't route this conversation through the relay. Reopen the channel and try again.";
  }
  return error instanceof Error ? error.message : String(error);
}

function isIdentifierValidationError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("Identifiers may only contain")
  );
}

function toChiefMessage(message: ConversationMessage): ChiefUIMessage {
  return {
    id: message.id,
    role: message.author.kind === "user" ? "user" : "assistant",
    metadata: {
      createdAt: Date.parse(message.createdAt),
      ...(message.author.kind === "agent"
        ? { agentId: message.author.id }
        : {}),
      ...(message.threadRootId ? { threadRootId: message.threadRootId } : {}),
      ...(message.mentions.length > 0 ? { mentions: message.mentions } : {}),
    },
    parts: [{ type: "text", text: message.deleted ? "" : message.body }],
  };
}

function toChannelEvent(
  message: ConversationMessage,
  snapshot: WorkspaceSnapshot,
) {
  const actor =
    message.author.kind === "agent"
      ? {
          type: "agent" as const,
          id: message.author.id,
          name:
            snapshot.agents.find((agent) => agent.id === message.author.id)
              ?.name ?? message.author.id,
        }
      : {
          type: "user" as const,
          id: message.author.id,
          name: message.author.kind === "system" ? "Chief" : "You",
        };
  return {
    protocol: "nip29" as const,
    id: message.id,
    channelId: message.conversationId,
    pubkey: actor.id,
    tags: [
      ["h", message.conversationId],
      ...(message.threadRootId ? [["e", message.threadRootId]] : []),
      ...message.mentions.map((mention) => ["p", mention]),
    ],
    content: message.deleted ? "" : message.body,
    actor,
    createdAt: Date.parse(message.createdAt),
    kind: 9 as const,
  };
}

function directAgentId(conversationId: string, snapshot: WorkspaceSnapshot) {
  const conversation = snapshot.conversations.find(
    (candidate) => candidate.id === conversationId,
  );
  return conversation ? agentForDirect(conversation.name, snapshot) : undefined;
}

function agentForDirect(name: string, snapshot: WorkspaceSnapshot) {
  const normalized = name.toLowerCase();
  return (
    snapshot.agents.find(
      (agent) =>
        normalized.includes(agent.id.toLowerCase()) ||
        normalized.includes(agent.name.toLowerCase()),
    )?.id ?? "chief"
  );
}
