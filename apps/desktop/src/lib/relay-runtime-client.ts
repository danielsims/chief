import type {
  AgentDefinition,
  ChiefUIMessage,
  ClientMessage,
  ServerMessage,
  WorkspaceChannel,
} from "@chief/agent-runtime/types";
import type {
  ConversationSubscription,
  RelayClient,
} from "@chief/relay-client";
import type {
  ConversationEvent,
  ConversationMessage,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import { RelayClientError } from "@chief/relay-client";
import { appendMessageCommandSchema } from "@chief/relay-contracts";

import type {
  RuntimeConnectionStatus,
  RuntimeMessageListener,
  RuntimeTransport,
} from "./runtime-transport";
import {
  relayConversationId,
  workspaceChannelFromRelay,
} from "./relay-channel-adapter";

const RELAY_CAPABILITY_DESCRIPTION =
  "Runs in its own isolated cell and collaborates through the Chief relay.";

export class RelayRuntimeClient implements RuntimeTransport {
  private listeners = new Set<RuntimeMessageListener>();
  private subscriptions = new Map<string, ConversationSubscription>();
  private pendingSubscriptions = new Map<
    string,
    Promise<ConversationSubscription>
  >();
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
    for (const subscription of this.subscriptions.values()) {
      subscription.close();
    }
    this.subscriptions.clear();
    this.pendingSubscriptions.clear();
    this.connect();
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
    for (const subscription of this.subscriptions.values()) {
      subscription.close();
    }
    this.subscriptions.clear();
    this.pendingSubscriptions.clear();
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
          relayConversationId(message.chatId, message.channelId),
        );
        return;
      case "observeChat":
        await this.openChat(
          message.chatId,
          relayConversationId(message.chatId),
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
  }

  private async openChat(chatId: string, conversationId: string) {
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
    await this.subscribeConversation(conversationId, (event) => {
      this.emit({
        type: "message",
        workspaceId: this.snapshot.id,
        chatId,
        message: toChiefMessage(event.payload.message),
      });
    });
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
    await this.subscribeConversation(conversationId, (event) => {
      this.emit({
        type: "channelEvent",
        workspaceId: this.snapshot.id,
        event: toChannelEvent(event.payload.message, this.snapshot),
      });
    });
  }

  private async subscribeConversation(
    conversationId: string,
    onEvent: (event: ConversationEvent) => void,
  ) {
    if (this.subscriptions.has(conversationId)) return;
    const pending = this.pendingSubscriptions.get(conversationId);
    if (pending) {
      await pending;
      return;
    }
    const generation = this.subscriptionGeneration;
    const subscriptionPromise = this.relay.subscribeConversation({
      conversationId,
      onEvent,
      onError: (error) => this.emitError(error, conversationId),
    });
    this.pendingSubscriptions.set(conversationId, subscriptionPromise);
    try {
      const subscription = await subscriptionPromise;
      if (this.closed || generation !== this.subscriptionGeneration) {
        subscription.close();
        return;
      }
      const existing = this.subscriptions.get(conversationId);
      if (existing) subscription.close();
      else this.subscriptions.set(conversationId, subscription);
    } finally {
      if (
        this.pendingSubscriptions.get(conversationId) === subscriptionPromise
      ) {
        this.pendingSubscriptions.delete(conversationId);
      }
    }
  }

  private async appendMessage(
    message: Extract<ClientMessage, { type: "sendMessage" }>,
  ) {
    const conversationId = relayConversationId(message.chatId);
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
    this.emit({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      ...(chatId ? { chatId } : {}),
    });
  }
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
  return snapshot.agents.find((agent) => conversationId.includes(agent.id))?.id;
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
