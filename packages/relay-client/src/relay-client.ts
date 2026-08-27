import type {
  AgentConfig,
  AgentConfigResult,
  AgentLease,
  AgentRuntimeDescriptor,
  AppendMessageCommand,
  AppendMessageResult,
  ChannelMember,
  ChannelMembership,
  ConversationEvent,
  DirectParticipant,
  DirectStartResult,
  JsonObject,
  LogBatch,
  LogPage,
  MessageComponent,
  RegisterAgentKeyResult,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  agentConfigResultSchema,
  agentLeaseSchema,
  agentRuntimeDescriptorSchema,
  appendMessageResultSchema,
  channelMembershipsResultSchema,
  channelMembersResultSchema,
  completeAgentJobResultSchema,
  conversationEventPageSchema,
  conversationIdSchema,
  directStartCommandSchema,
  directStartResultSchema,
  logPageSchema,
  logReceiptSchema,
  messagePageSchema,
  reactToMessageResultSchema,
  registerAgentKeyResultSchema,
  renewAgentJobResultSchema,
  socketTicketSchema,
  upsertAgentActivityResultSchema,
  workspaceSecretListResultSchema,
  workspaceSecretResultSchema,
  workspaceSocketTicketSchema,
} from "@chief/relay-contracts";

import type { RelayClientOptions } from "./relay-client-options";
import type { RelayConversationSubscription } from "./relay-subscription";
import type { RelayWorkspaceSubscription } from "./relay-workspace-subscription";
import { RelayClientBase } from "./relay-client-base";
import { RelayClientError } from "./relay-client-error";
import { openRelayConversationSubscription } from "./relay-subscription";
import { openRelayWorkspaceSubscription } from "./relay-workspace-subscription";

export type { RelayClientOptions } from "./relay-client-options";
export { RelayClientError } from "./relay-client-error";

export type ConversationSubscription = RelayConversationSubscription;
export type WorkspaceSubscription = RelayWorkspaceSubscription;

export class RelayClient extends RelayClientBase {
  constructor(options: RelayClientOptions) {
    super(options);
  }

  forWorkspace(workspaceId: WorkspaceId | string) {
    return new RelayClient({ ...this.options, workspaceId });
  }

  async setWorkspaceSecret(name: string, value: string) {
    return await this.fetchJson(
      this.workspaceUrl("secrets"),
      workspaceSecretResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, value }),
      },
    );
  }

  async listWorkspaceSecrets() {
    return (
      await this.fetchJson(
        this.workspaceUrl("secrets"),
        workspaceSecretListResultSchema,
        true,
      )
    ).secrets;
  }

  async deleteWorkspaceSecret(name: string) {
    return await this.fetchJson(
      this.workspaceUrl(`secrets?name=${encodeURIComponent(name)}`),
      workspaceSecretResultSchema,
      true,
      { method: "DELETE" },
    );
  }

  async listChannelMembers(conversationId: string): Promise<ChannelMember[]> {
    const conversation = conversationIdSchema.parse(conversationId);
    return (
      await this.fetchJson(
        this.workspaceUrl(
          `channels/${encodeURIComponent(conversation)}/members`,
        ),
        channelMembersResultSchema,
      )
    ).members;
  }

  async listCurrentChannelMemberships(): Promise<ChannelMembership[]> {
    return (
      await this.fetchJson(
        this.workspaceUrl("channels/memberships/self"),
        channelMembershipsResultSchema,
      )
    ).memberships;
  }

  async startDirectMessage(
    participant: DirectParticipant,
  ): Promise<DirectStartResult> {
    return await this.fetchJson(
      this.workspaceUrl("directs"),
      directStartResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          directStartCommandSchema.parse({
            commandId: crypto.randomUUID(),
            protocolVersion: 1,
            occurredAt: new Date().toISOString(),
            payload: { participant },
          }),
        ),
      },
    );
  }

  async loadAgentConfig(agentId: string): Promise<AgentConfigResult> {
    return await this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}/config`),
      agentConfigResultSchema,
    );
  }

  async loadAgentRuntime(agentId: string): Promise<AgentRuntimeDescriptor> {
    return await this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}`),
      agentRuntimeDescriptorSchema,
    );
  }

  async saveAgentConfig(
    agentId: string,
    config: AgentConfig,
  ): Promise<AgentConfigResult> {
    return await this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}/config`),
      agentConfigResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, config }),
      },
    );
  }

  async registerAgentKey(
    agentId: string,
    pubkey: string,
  ): Promise<RegisterAgentKeyResult> {
    return await this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}/keys`),
      registerAgentKeyResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, pubkey }),
      },
    );
  }

  async claimAgentJob(
    agentId: string,
    workerId: string,
    leaseSeconds = 300,
  ): Promise<AgentLease | null> {
    const url = this.workspaceUrl(
      `agents/${encodeURIComponent(agentId)}/jobs/claim`,
    );
    const body = JSON.stringify({ workerId, leaseSeconds });
    const response = await this.fetchResponse(url, true, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (response.status === 204) return null;
    if (!response.ok) throw await RelayClientError.fromResponse(response);
    return agentLeaseSchema.parse(await response.json());
  }

  async completeAgentJob(
    agentId: string,
    command: {
      leaseToken: string;
      outcome:
        | {
            status: "completed";
            result?: JsonObject;
          }
        | { status: "failed"; error: string; retryAt?: string };
    },
  ) {
    return await this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}/jobs/complete`),
      completeAgentJobResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      },
    );
  }

  async renewAgentJob(agentId: string, leaseToken: string, leaseSeconds = 300) {
    return await this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}/jobs/renew`),
      renewAgentJobResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseToken, leaseSeconds }),
      },
    );
  }

  async createAgentMailboxTicket(agentId: string) {
    return await this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}/socket-tickets`),
      socketTicketSchema,
      true,
      { method: "POST" },
    );
  }

  async listChannelMemberships(): Promise<ChannelMembership[]> {
    return (
      await this.fetchJson(
        this.workspaceUrl("channels/memberships"),
        channelMembershipsResultSchema,
      )
    ).memberships;
  }

  async listMessages(
    conversationId: string,
    input: { after?: number; limit?: number; recent?: boolean } = {},
  ) {
    const url = this.conversationUrl(conversationId, "messages");
    appendPageQuery(url, input);
    if (input.recent) url.searchParams.set("recent", "true");
    return this.fetchJson(url, messagePageSchema);
  }

  async listThreadReplies(
    conversationId: string,
    rootMessageId: string,
    input: { after?: number; limit?: number } = {},
  ) {
    const root = encodeURIComponent(rootMessageId);
    const url = this.conversationUrl(
      conversationId,
      `messages/${root}/replies`,
    );
    appendPageQuery(url, input);
    return this.fetchJson(url, messagePageSchema);
  }

  async searchMessages(
    conversationId: string,
    query: string,
    input: { limit?: number } = {},
  ) {
    const url = this.conversationUrl(conversationId, "messages");
    url.searchParams.set("q", query.trim());
    appendPageQuery(url, input);
    return this.fetchJson(url, messagePageSchema);
  }

  async reactToMessage(
    conversationId: string,
    messageId: string,
    emoji: string,
    add: boolean,
  ) {
    return await this.fetchJson(
      this.conversationUrl(
        conversationId,
        `messages/${encodeURIComponent(messageId)}/reactions`,
      ),
      reactToMessageResultSchema,
      true,
      {
        method: add ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, emoji }),
      },
    );
  }

  async listEvents(
    conversationId: string,
    input: { after?: number; limit?: number } = {},
  ) {
    const url = this.conversationUrl(conversationId, "events");
    appendPageQuery(url, input);
    return this.fetchJson(url, conversationEventPageSchema);
  }

  async appendMessage(
    conversationId: string,
    command: AppendMessageCommand,
  ): Promise<AppendMessageResult> {
    return await this.fetchJson(
      this.conversationUrl(conversationId, "messages"),
      appendMessageResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      },
    );
  }

  async upsertAgentActivity(
    conversationId: string,
    input: {
      messageId: string;
      threadRootId?: string;
      component: MessageComponent;
    },
  ) {
    return await this.fetchJson(
      this.conversationUrl(
        conversationId,
        `messages/${encodeURIComponent(input.messageId)}/activity`,
      ),
      upsertAgentActivityResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, conversationId }),
      },
    );
  }

  async recordLogs(batch: LogBatch) {
    return await this.fetchJson(
      this.workspaceUrl("logs"),
      logReceiptSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
      },
    );
  }

  async listLogs(
    input: { cursor?: string; limit?: number } = {},
  ): Promise<LogPage> {
    const url = this.workspaceUrl("logs");
    if (input.cursor) url.searchParams.set("cursor", input.cursor);
    if (input.limit !== undefined)
      url.searchParams.set("limit", String(input.limit));
    return await this.fetchJson(url, logPageSchema);
  }

  async subscribeConversation(input: {
    conversationId: string;
    after?: number;
    onEvent: (event: ConversationEvent) => void;
    onError?: (error: Error) => void;
  }): Promise<ConversationSubscription> {
    const workspaceId = this.requireWorkspaceId();
    const conversationId = conversationIdSchema.parse(input.conversationId);
    return await openRelayConversationSubscription({
      workspaceId,
      conversationId,
      after: input.after,
      discovery: () => this.discovery(),
      createTicket: () =>
        this.fetchJson(
          this.conversationUrl(conversationId, "socket-tickets"),
          socketTicketSchema,
          true,
          { method: "POST" },
        ),
      listEvents: (after) =>
        this.listEvents(conversationId, { after, limit: 200 }),
      createWebSocket: this.createWebSocket,
      onEvent: input.onEvent,
      onError: input.onError,
    });
  }

  async subscribeWorkspace(input: {
    conversationIds: readonly string[];
    after?: number;
    onEvent: (event: ConversationEvent) => void;
    onError?: (error: Error) => void;
  }): Promise<WorkspaceSubscription> {
    const workspaceId = this.requireWorkspaceId();
    return await openRelayWorkspaceSubscription({
      workspaceId,
      conversationIds: input.conversationIds.map((id) =>
        conversationIdSchema.parse(id),
      ),
      after: input.after,
      discovery: () => this.discovery(),
      createTicket: () =>
        this.fetchJson(
          this.workspaceUrl("socket-tickets"),
          workspaceSocketTicketSchema,
          true,
          { method: "POST" },
        ),
      createWebSocket: this.createWebSocket,
      onEvent: input.onEvent,
      onError: input.onError,
    });
  }
}

function appendPageQuery(url: URL, input: { after?: number; limit?: number }) {
  if (input.after !== undefined)
    url.searchParams.set("after", String(input.after));
  if (input.limit !== undefined)
    url.searchParams.set("limit", String(input.limit));
}
