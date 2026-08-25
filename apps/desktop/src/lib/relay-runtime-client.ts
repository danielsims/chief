import { invoke, isTauri } from "@tauri-apps/api/core";

import type { ClientMessage, ServerMessage } from "@chief/agent-runtime/types";
import type { WorkspaceSubscription } from "@chief/relay-client";
import type {
  ConversationEvent,
  ConversationMessage,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";
import { agentIdSchema } from "@chief/relay-contracts";

import type { RelayRuntimeRelay } from "./relay-runtime-relay";
import type {
  RuntimeConnectionStatus,
  RuntimeMessageListener,
  RuntimeTransport,
} from "./runtime-transport";
import { recordDesktopActivityReceipt } from "./relay-activity-diagnostics";
import { relayConversationId } from "./relay-channel-adapter";
import {
  relayAgentDefinitions,
  relayAgentPreferencesMessage,
  saveRelayAgentPreference,
} from "./relay-runtime-agents";
import {
  createRelayWorkspaceChannel,
  loadRelayWorkspaceChannels,
} from "./relay-runtime-channels";
import {
  parseRelayError,
  relayRuntimeErrorMessage,
} from "./relay-runtime-errors";
import {
  agentForDirect,
  agentRunEvent,
  directAgentId,
  isAgentActivityProjection,
  toChannelEvents,
  toChannelMessageEvent,
  toChiefMessage,
} from "./relay-runtime-mappers";
import { appendRelayMessage } from "./relay-runtime-messages";
import { routeRelayWorkspaceDataCommand } from "./relay-runtime-workspace-data";
import {
  loadWorkspaceCursor,
  saveWorkspaceCursor,
} from "./relay-workspace-cursor";

export class RelayRuntimeClient implements RuntimeTransport {
  private listeners = new Set<RuntimeMessageListener>();
  private workspaceSubscription: WorkspaceSubscription | null = null;
  private pendingWorkspaceSubscription: Promise<WorkspaceSubscription> | null =
    null;
  private subscribedConversationIds = new Set<string>();
  private workspaceCursor: number | undefined;
  private conversationIdsByChat = new Map<string, string>();
  private messagesById = new Map<string, ConversationMessage>();
  private readonly devicePubkey = isTauri()
    ? invoke<string>("relay_public_key").catch(() => null)
    : Promise.resolve(null);
  private subscriptionGeneration = 0;
  private statusListener: (status: RuntimeConnectionStatus) => void = () =>
    undefined;
  private snapshot: WorkspaceSnapshot;
  private closed = false;

  constructor(
    private readonly relay: RelayRuntimeRelay,
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
      .then(() => {
        this.emit({
          type: "agents",
          agents: relayAgentDefinitions(this.snapshot),
        });
        this.statusListener("connected");
      })
      .catch((error) => {
        this.statusListener("disconnected");
        this.recordError(parseRelayError(error));
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
    void this.route(message).catch((error) => {
      const chatId = "chatId" in message ? message.chatId : undefined;
      const requestId = "requestId" in message ? message.requestId : undefined;
      this.recordError(parseRelayError(error), chatId, requestId);
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
    if (
      await routeRelayWorkspaceDataCommand(message, {
        relay: this.relay,
        snapshot: this.snapshot,
        emit: (event) => this.emit(event),
      })
    ) {
      return;
    }
    switch (message.type) {
      case "listAgents":
        this.emit({
          type: "agents",
          agents: relayAgentDefinitions(this.snapshot),
        });
        return;
      case "listChannels":
        await this.listChannels();
        return;
      case "createChannel":
        await this.createChannel(message);
        return;
      case "listChats":
        await this.listChats();
        return;
      case "listAgentPreferences":
        this.emit(
          await relayAgentPreferencesMessage(this.relay, this.snapshot),
        );
        return;
      case "saveAgentPreference":
        await saveRelayAgentPreference(this.relay, this.snapshot, message);
        this.emit(
          await relayAgentPreferencesMessage(
            this.relay,
            this.snapshot,
            message.requestId,
          ),
        );
        return;
      case "listChannelEvents":
        await this.openChannelEvents(message.channelId);
        return;
      case "reactToChannelMessage":
        await this.toggleReaction(message);
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
        this.recordError(
          new Error(`Relay command ${message.type} is not implemented.`),
          "chatId" in message ? message.chatId : undefined,
        );
        return;
    }
  }

  private async refreshSnapshot() {
    this.snapshot = await this.relay.activeWorkspace();
  }

  private async listChannels() {
    const { channels, currentMemberships } = await loadRelayWorkspaceChannels(
      this.relay,
      this.snapshot,
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

  private async createChannel(
    message: Extract<ClientMessage, { type: "createChannel" }>,
  ) {
    const channel = await createRelayWorkspaceChannel(this.relay, message.name);
    this.subscribedConversationIds.add(channel.id);
    await this.refreshSnapshot();
    this.emit({
      type: "channelCreated",
      requestId: message.requestId,
      workspaceId: this.snapshot.id,
      channel,
    });
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
    for (const message of page.messages) this.rememberMessage(message);
    this.emit({
      type: "chatOpened",
      workspaceId: this.snapshot.id,
      chatId,
      visibility: "user",
      ...(agentId ? { agentId } : undefined),
    });
    this.emit({
      type: "history",
      workspaceId: this.snapshot.id,
      chatId,
      messages: page.messages.map((message) => toChiefMessage(message)),
      events: page.messages.flatMap((message) => {
        const event = agentRunEvent(message);
        return event ? [event] : [];
      }),
      running: false,
    });
    await this.subscribeConversation(conversationId);
  }

  private async openChannelEvents(conversationId: string) {
    const page = await this.relay.listMessages(conversationId, { limit: 200 });
    for (const message of page.messages) this.rememberMessage(message);
    const currentPubkey = await this.devicePubkey;
    this.emit({
      type: "channelEvents",
      workspaceId: this.snapshot.id,
      channelId: conversationId,
      events: page.messages.flatMap((message) =>
        toChannelEvents(message, this.snapshot, currentPubkey),
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
      onError: (error) => this.recordError(parseRelayError(error)),
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
    const runEvent = agentRunEvent(message);
    const isActivity = isAgentActivityProjection(message);
    if (isActivity) recordDesktopActivityReceipt(this.snapshot.id, event);
    this.rememberMessage(message);
    if (
      !isActivity &&
      this.snapshot.conversations.some(
        (conversation) =>
          conversation.id === message.conversationId &&
          conversation.kind === "channel",
      )
    ) {
      // Re-read folded reactions so removals replace synthetic NIP-25 events.
      if (
        event.type === "conversation.message.reacted" ||
        event.type === "conversation.message.edited" ||
        event.type === "conversation.message.deleted"
      ) {
        void this.openChannelEvents(message.conversationId).catch((error) =>
          this.recordError(parseRelayError(error)),
        );
      } else {
        this.emit({
          type: "channelEvent",
          workspaceId: this.snapshot.id,
          event: toChannelMessageEvent(message, this.snapshot),
        });
      }
    }
    for (const [chatId, conversationId] of this.conversationIdsByChat) {
      if (conversationId !== message.conversationId) continue;
      this.emit({
        type: "message",
        workspaceId: this.snapshot.id,
        chatId,
        message: toChiefMessage(message),
      });
      if (runEvent) {
        this.emit({
          type: "event",
          workspaceId: this.snapshot.id,
          chatId,
          event: runEvent,
        });
      }
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
    const result = await appendRelayMessage(
      this.relay,
      conversationId,
      message,
    );
    this.rememberMessage(result.message);
    this.emit({
      type: "message",
      workspaceId: this.snapshot.id,
      chatId: message.chatId,
      message: toChiefMessage(result.message),
    });
  }
  private rememberMessage(message: ConversationMessage) {
    this.messagesById.set(message.id, message);
  }
  private async toggleReaction(
    message: Extract<ClientMessage, { type: "reactToChannelMessage" }>,
  ) {
    const pubkey = await this.devicePubkey;
    let target = this.messagesById.get(message.messageId);
    if (!target) {
      const page = await this.relay.listMessages(message.channelId, {
        limit: 200,
      });
      for (const item of page.messages) this.rememberMessage(item);
      target = this.messagesById.get(message.messageId);
    }
    const reacted = Boolean(
      pubkey &&
      target?.reactions.some(
        (reaction) =>
          reaction.emoji === message.reaction &&
          reaction.pubkeys.includes(pubkey),
      ),
    );
    const result = await this.relay.reactToMessage(
      message.channelId,
      message.messageId,
      message.reaction,
      !reacted,
    );
    this.rememberMessage(result.message);
    await this.openChannelEvents(message.channelId);
  }
  private emit(message: ServerMessage) {
    for (const listener of this.listeners) listener(message);
  }

  private recordError(error: Error, chatId?: string, requestId?: string) {
    console.error("[Chief relay] Runtime request failed", error);
    this.emit(relayRuntimeErrorMessage(error, chatId, requestId));
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
