import type {
  AppendMessageCommand,
  AppendMessageResult,
  ChannelMember,
  ChannelMembership,
  ChannelRecord,
  ConversationEvent,
  CreateWorkspaceCommand,
  LogBatch,
  LogPage,
  RelayDiscovery,
  WorkspaceId,
  WorkspaceInvite,
  WorkspaceInviteClaimResult,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from "@chief/relay-contracts";
import {
  appendMessageResultSchema,
  channelListResultSchema,
  channelMembershipsResultSchema,
  channelMembersResultSchema,
  conversationEventPageSchema,
  conversationIdSchema,
  logPageSchema,
  logReceiptSchema,
  messagePageSchema,
  relayDiscoverySchema,
  socketTicketSchema,
  workspaceDeleteResultSchema,
  workspaceIdSchema,
  workspaceInviteClaimResultSchema,
  workspaceInviteSchema,
  workspaceListResultSchema,
  workspaceSnapshotSchema,
  workspaceSwitchResultSchema,
} from "@chief/relay-contracts";

import type { RelayConversationSubscription } from "./relay-subscription";
import { openRelayConversationSubscription } from "./relay-subscription";

export interface RelayClientOptions {
  relayUrl: string;
  workspaceId?: WorkspaceId | string;
  getAuthorization?: (request: {
    url: string;
    method: string;
    body: string;
  }) => Promise<string>;
  fetch?: typeof globalThis.fetch;
  createWebSocket?: (url: string) => WebSocket;
}

export type ConversationSubscription = RelayConversationSubscription;

export class RelayClient {
  readonly workspaceId: WorkspaceId | null;
  private readonly relayUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly createWebSocket: (url: string) => WebSocket;
  private discoveryRequest: Promise<RelayDiscovery> | null = null;

  constructor(private readonly options: RelayClientOptions) {
    this.workspaceId = options.workspaceId
      ? workspaceIdSchema.parse(options.workspaceId)
      : null;
    this.relayUrl = normalizedOrigin(options.relayUrl);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.createWebSocket =
      options.createWebSocket ?? ((url) => new WebSocket(url));
  }

  discovery() {
    this.discoveryRequest ??= this.fetchJson(
      `${this.relayUrl}/.well-known/chief-relay`,
      relayDiscoverySchema,
      false,
    );
    return this.discoveryRequest;
  }

  activeWorkspace(): Promise<WorkspaceSnapshot> {
    return this.fetchJson(
      new URL("/v1/me/workspace", this.relayUrl),
      workspaceSnapshotSchema,
    );
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return (
      await this.fetchJson(
        new URL("/v1/workspaces", this.relayUrl),
        workspaceListResultSchema,
      )
    ).workspaces;
  }

  async createWorkspace(command: CreateWorkspaceCommand) {
    return await this.fetchJson(
      new URL("/v1/workspaces", this.relayUrl),
      workspaceSnapshotSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      },
    );
  }

  async switchWorkspace(workspaceId: WorkspaceId | string) {
    const id = workspaceIdSchema.parse(workspaceId);
    return await this.fetchJson(
      new URL(`/v1/workspaces/${encodeURIComponent(id)}/switch`, this.relayUrl),
      workspaceSwitchResultSchema,
      true,
      { method: "POST" },
    );
  }

  async deleteWorkspace(workspaceId: WorkspaceId | string) {
    const id = workspaceIdSchema.parse(workspaceId);
    return await this.fetchJson(
      new URL(`/v1/workspaces/${encodeURIComponent(id)}`, this.relayUrl),
      workspaceDeleteResultSchema,
      true,
      { method: "DELETE" },
    );
  }

  async createWorkspaceInvite(input: {
    secret: string;
    conversationId?: string | null;
    expiresAt: string;
  }): Promise<WorkspaceInvite> {
    return await this.fetchJson(
      this.workspaceUrl("invites"),
      workspaceInviteSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          secret: input.secret,
          conversationId: input.conversationId ?? null,
          expiresAt: input.expiresAt,
        }),
      },
    );
  }

  async previewWorkspaceInvite(
    workspaceId: WorkspaceId | string,
    secret: string,
  ): Promise<WorkspaceInvite> {
    const id = workspaceIdSchema.parse(workspaceId);
    return await this.fetchJson(
      new URL(
        `/v1/workspaces/${encodeURIComponent(id)}/invites/preview`,
        this.relayUrl,
      ),
      workspaceInviteSchema,
      false,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      },
    );
  }

  async claimWorkspaceInvite(
    workspaceId: WorkspaceId | string,
    secret: string,
  ): Promise<WorkspaceInviteClaimResult> {
    const id = workspaceIdSchema.parse(workspaceId);
    return await this.fetchJson(
      new URL(
        `/v1/workspaces/${encodeURIComponent(id)}/invites/claim`,
        this.relayUrl,
      ),
      workspaceInviteClaimResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), secret }),
      },
    );
  }

  async listChannels(): Promise<ChannelRecord[]> {
    return (
      await this.fetchJson(
        this.workspaceUrl("channels"),
        channelListResultSchema,
      )
    ).channels;
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
    input: { after?: number; limit?: number } = {},
  ) {
    const url = this.conversationUrl(conversationId, "messages");
    appendPageQuery(url, input);
    return this.fetchJson(url, messagePageSchema);
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

  private conversationUrl(conversationId: string, resource: string) {
    const workspaceId = this.requireWorkspaceId();
    const conversation = conversationIdSchema.parse(conversationId);
    return new URL(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversation)}/${resource}`,
      this.relayUrl,
    );
  }

  private workspaceUrl(resource: string) {
    const workspaceId = this.requireWorkspaceId();
    return new URL(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/${resource}`,
      this.relayUrl,
    );
  }

  private requireWorkspaceId() {
    if (!this.workspaceId) {
      throw new Error("Choose a workspace before using workspace resources.");
    }
    return this.workspaceId;
  }

  private async fetchJson<T>(
    url: URL | string,
    schema: { parse: (value: unknown) => T },
    authenticated = true,
    init: RequestInit = {},
  ) {
    const headers = new Headers(init.headers);
    if (authenticated) {
      const method = init.method?.toUpperCase() ?? "GET";
      const body = typeof init.body === "string" ? init.body : "";
      if (!this.options.getAuthorization) {
        throw new Error("Relay authorization is not configured.");
      }
      const authorization = await this.options.getAuthorization({
        url: url.toString(),
        method,
        body,
      });
      headers.set("authorization", authorization);
    }
    const response = await this.fetcher(url, { ...init, headers });
    if (!response.ok) throw await RelayClientError.fromResponse(response);
    return schema.parse(await response.json());
  }
}

export class RelayClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }

  static async fromResponse(response: Response) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    return new RelayClientError(
      body?.error?.message ?? `Relay request failed with ${response.status}.`,
      response.status,
      body?.error?.code,
    );
  }
}

function normalizedOrigin(value: string) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function appendPageQuery(url: URL, input: { after?: number; limit?: number }) {
  if (input.after !== undefined)
    url.searchParams.set("after", String(input.after));
  if (input.limit !== undefined)
    url.searchParams.set("limit", String(input.limit));
}
