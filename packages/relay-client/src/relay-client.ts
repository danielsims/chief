import type {
  AgentConfig,
  AgentConfigResult,
  AgentLease,
  AgentRuntimeDescriptor,
  AgentSummary,
  AppendMessageCommand,
  AppendMessageResult,
  ChannelMember,
  ChannelMembership,
  ConversationEvent,
  CreateNativeAgentCommand,
  DirectParticipant,
  DirectStartResult,
  JsonObject,
  LogBatch,
  LogPage,
  Machine,
  MachineCreate,
  MachineUpdate,
  MessageComponent,
  MissionCreate,
  MissionExperimentInput,
  RegisterAgentKeyResult,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  agentConfigResultSchema,
  agentJobListSchema,
  agentLeaseSchema,
  agentRemovalResultSchema,
  agentRuntimeDescriptorSchema,
  agentSummarySchema,
  appendMessageResultSchema,
  channelMembershipsResultSchema,
  channelMembersResultSchema,
  completeAgentJobResultSchema,
  conversationEventPageSchema,
  conversationIdSchema,
  createNativeAgentResultSchema,
  directStartCommandSchema,
  directStartResultSchema,
  logPageSchema,
  logReceiptSchema,
  machineCreateSchema,
  machineDeleteResultSchema,
  machineSchema,
  machinesResultSchema,
  machineUpdateSchema,
  messagePageSchema,
  missionListSchema,
  missionSchema,
  reactToMessageResultSchema,
  registerAgentKeyResultSchema,
  renewAgentJobResultSchema,
  socketTicketSchema,
  upsertAgentActivityResultSchema,
  workspaceSocketTicketSchema,
} from "@chief/relay-contracts";

import type { RelayClientOptions } from "./relay-client-options";
import type { RelayConversationSubscription } from "./relay-subscription";
import type { RelayWorkspaceSubscription } from "./relay-workspace-subscription";
import { RelayClientError } from "./relay-client-error";
import { RelayExternalAgentsClient } from "./relay-external-agents-client";
import { RelaySchedulesClient } from "./relay-schedules-client";
import { openRelayConversationSubscription } from "./relay-subscription";
import { RelayVercelProvisioning } from "./relay-vercel-provisioning";
import { openRelayWorkspaceSubscription } from "./relay-workspace-subscription";

export type { RelayClientOptions } from "./relay-client-options";
export { RelayClientError } from "./relay-client-error";

export type ConversationSubscription = RelayConversationSubscription;
export type WorkspaceSubscription = RelayWorkspaceSubscription;

export class RelayClient extends RelayVercelProvisioning {
  readonly externalAgents: RelayExternalAgentsClient;
  readonly schedules: Pick<
    RelaySchedulesClient,
    | "list"
    | "save"
    | "act"
    | "delete"
    | "runs"
    | "runAction"
    | "reportStep"
    | "webhooks"
    | "createWebhook"
    | "webhookAction"
  >;

  constructor(options: RelayClientOptions) {
    super(options);
    this.externalAgents = new RelayExternalAgentsClient(options);
    this.schedules = new RelaySchedulesClient(options);
  }

  forWorkspace(workspaceId: WorkspaceId | string) {
    return new RelayClient({ ...this.options, workspaceId });
  }
  async listMissions() {
    return (
      await this.fetchJson(this.workspaceUrl("missions"), missionListSchema)
    ).missions;
  }
  async createMission(input: MissionCreate) {
    return this.fetchJson(this.workspaceUrl("missions"), missionSchema, true, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }
  async recordMissionExperiment(id: string, input: MissionExperimentInput) {
    return this.fetchJson(
      this.workspaceUrl(`missions/${encodeURIComponent(id)}/experiments`),
      missionSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }
  async updateMissionStatus(
    id: string,
    status: "active" | "paused" | "completed",
    evidence: string,
  ) {
    return this.fetchJson(
      this.workspaceUrl(`missions/${encodeURIComponent(id)}/status`),
      missionSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, evidence }),
      },
    );
  }

  async listMachines(): Promise<Machine[]> {
    return (
      await this.fetchJson(this.workspaceUrl("machines"), machinesResultSchema)
    ).machines;
  }

  async createMachine(input: MachineCreate): Promise<Machine> {
    return this.fetchJson(this.workspaceUrl("machines"), machineSchema, true, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(machineCreateSchema.parse(input)),
    });
  }

  async updateMachine(id: string, input: MachineUpdate): Promise<Machine> {
    return this.fetchJson(
      this.workspaceUrl(`machines/${encodeURIComponent(id)}`),
      machineSchema,
      true,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(machineUpdateSchema.parse(input)),
      },
    );
  }

  async deleteMachine(id: string) {
    return this.fetchJson(
      this.workspaceUrl(`machines/${encodeURIComponent(id)}`),
      machineDeleteResultSchema,
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
    const url = this.workspaceUrl(
      `agents/${encodeURIComponent(agentId)}/config`,
    );
    return await this.fetchJson(url, agentConfigResultSchema);
  }
  async loadOwnAgentProfile(): Promise<AgentSummary> {
    return this.fetchJson(
      this.workspaceUrl("agents/self/profile"),
      agentSummarySchema,
    );
  }
  async loadAgentRuntime(agentId: string): Promise<AgentRuntimeDescriptor> {
    const url = this.workspaceUrl(`agents/${encodeURIComponent(agentId)}`);
    return await this.fetchJson(url, agentRuntimeDescriptorSchema);
  }
  async removeAgent(agentId: string) {
    const url = this.workspaceUrl(`agents/${encodeURIComponent(agentId)}`);
    return await this.fetchJson(url, agentRemovalResultSchema, true, {
      method: "DELETE",
    });
  }
  async createNativeAgent(
    input: CreateNativeAgentCommand,
  ): Promise<AgentSummary> {
    const result = await this.fetchJson(
      this.workspaceUrl("agents"),
      createNativeAgentResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    return result.agent;
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

  async listAgentJobs(agentId: string) {
    const result = await this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}/jobs`),
      agentJobListSchema,
      true,
    );
    return result.jobs;
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
